// Extraction IA robuste (1.0.2) : réponse vide → message clair + 2ᵉ essai plus court ; limite de messages ; JSON toléré.
// Prérequis : SillyTavern (http://localhost:8011/) avec l'extension, et `node tests/mock-openai.mjs 9101`.
import { boot, connect, selectChar, mock, mockLog, mockClear, shot, ok, sleep } from './lib.mjs';

const { browser, page, errs } = await boot();
await connect(page);
await selectChar(page, 'Seraphina');
const P = (fn, arg) => page.evaluate(fn, arg);
const setS = (patch) => P((p) => { Object.assign(globalThis.permanentMemory.settings(), p); }, patch);
const isExtraction = (r) => (r.messages || []).some((m) => /mémoire à long terme d'un jeu de rôle/.test(String(m.content)));
const countMsgs = (r) => (r.messages || []).filter((m) => /Messages :/.test(String(m.content))).map((m) => String(m.content).split('\n').filter((l) => /^[^:\n]{1,40}: Message \d+ du jeu/.test(l)).length)[0] || 0;

// chat de 163 messages (RP long)
await P(() => {
    const c = SillyTavern.getContext();
    c.chat.length = 1;
    for (let i = 1; i < 163; i++) {
        const user = i % 2 === 1;
        c.chat.push({ name: user ? c.name1 : 'Seraphina', is_user: user, is_system: false, send_date: Date.now(), mes: `Message ${i} du jeu de rôle : ${user ? 'Léo' : 'Seraphina'} marche dans la forêt de Valmont et parle de la promesse numéro ${i}, ` + 'avec beaucoup de détails inutiles sur les arbres. '.repeat(6) });
    }
});
console.log('messages dans le chat :', await P(() => SillyTavern.getContext().chat.length));
await setS({ enabled: true, neverAI: false, autoExtract: false, autoSummary: false, maxCallsPerDay: 20, maxTokensPerMonth: 5000000, autoMaxTokens: 200, extractMessages: 40, extractInputTokens: 3000, autoToInbox: true });
await P(() => { const s = globalThis.permanentMemory.store; s.store.candidates.length = 0; s.resetStats(); });
const run = () => P(async () => globalThis.permanentMemory.engine.runExtraction({ manual: true }));
const cands = () => P(() => globalThis.permanentMemory.store.store.candidates.filter((c) => c.origin === 'ia').map((c) => c.text));

// ---- 1. réglage par défaut + aucun appel sans action
ok(await P(() => globalThis.permanentMemory.settings().extractMessages === 40), 'Réglage « Nombre de messages à analyser » : 40 par défaut');
await mockClear();
await sleep(1500);
ok((await mockLog()).length === 0, 'Aucun appel IA sans action (comportement par défaut conservé)');

// ---- 2. réponse vide ×2 : message clair, 2 appels, 2ᵉ plus court
await mock({ queue: ['empty', 'empty'] });
let r = await run();
let log = await mockLog();
const ex = log.filter(isExtraction);
console.log('résultat vide :', JSON.stringify(r).slice(0, 300));
ok(!r.ok && r.empty, 'Réponse vide → ok:false, empty:true');
ok(ex.length === 2, `Exactement 2 appels (1 + 1 relance) : ${ex.length}`);
const n1 = countMsgs(ex[0]); const n2 = countMsgs(ex[1]);
ok(n1 > 0 && n1 <= 40, `1er appel ≤ 40 messages sur 163 : ${n1}`);
ok(n2 > 0 && n2 <= 12 && n2 < n1, `2ᵉ appel plus court : ${n2} messages`);
ok(!/No message generated/i.test(r.reason + r.detail), 'Le message n’affiche pas « No message generated »');
ok(/Causes probables/.test(r.detail) && /réflexion/.test(r.detail) && /Nombre de messages à analyser/.test(r.detail), 'Message français clair avec causes (réflexion, tokens, nombre de messages)');
ok(await P(() => globalThis.permanentMemory.settings().stats.callsToday === 2), 'Les 2 appels sont comptés dans le plafond');

// ---- 3. vide puis valide (JSON dans ``` avec texte autour) → relance réussie
await mockClear();
const JSON_ANS = 'Voici les faits :\n```json\n[{"type":"relation","importance":5,"text":"Léo a promis de protéger Seraphina","keywords":["Léo"]},{"type":"lieu","text":"La forêt de Valmont est dangereuse la nuit"}]\n```';
await mock({ queue: ['empty', { text: JSON_ANS }] });
r = await run();
log = (await mockLog()).filter(isExtraction);
ok(r.ok && r.retried && log.length === 2, `Vide puis valide → succès après relance (retried=${r.retried}, appels=${log.length})`);
ok(r.found === 2 && r.added === 2, `JSON toléré (\`\`\` + texte autour) : ${r.found} trouvé(s), ${r.added} ajouté(s)`);
ok((await cands()).some((t) => /protéger Seraphina/.test(t)), 'Candidat IA créé');

// ---- 4. réponse valide du 1er coup (format lignes) → 1 seul appel
await mockClear();
await mock({ queue: [{ text: 'fait|3|Seraphina garde la clé du phare|clé,phare' }] });
r = await run();
log = (await mockLog()).filter(isExtraction);
ok(r.ok && !r.retried && log.length === 1 && r.added === 1, `Réponse valide du 1er coup → 1 seul appel (${log.length})`);

// ---- 5. réflexion seule (<think> tronqué) = vide → relance
await mockClear();
await mock({ queue: [{ text: '<think>Je dois analyser les messages et' }, { text: 'RIEN' }] });
r = await run();
log = (await mockLog()).filter(isExtraction);
ok(r.ok && r.retried && r.found === 0 && log.length === 2, 'Réflexion seule → relance ; « RIEN » accepté (0 fait)');

// ---- 6. erreur d’API réelle (HTTP 500) : message d’erreur API, pas de relance
await mockClear();
await mock({ queue: ['error'] });
r = await run();
log = (await mockLog()).filter(isExtraction);
ok(!r.ok && !r.empty && /Erreur de l’API/.test(r.reason) && log.length === 1, `Erreur HTTP → « ${r.reason.slice(0, 80)} », pas de relance`);

// ---- 7. limite de messages + budget de tokens
await mockClear();
await mock({ default: 'ok', queue: [{ text: 'RIEN' }] });
await setS({ extractMessages: 8 });
await run();
let l = (await mockLog()).filter(isExtraction);
ok(countMsgs(l[0]) === 8, `Réglage 8 messages respecté : ${countMsgs(l[0])}`);
await mockClear();
await mock({ queue: [{ text: 'RIEN' }] });
await setS({ extractMessages: 100, extractInputTokens: 800 });
await run();
l = (await mockLog()).filter(isExtraction);
const nb = countMsgs(l[0]);
ok(nb > 0 && nb < 100, `Budget de tokens (800) : historique tronqué à ${nb} message(s) au lieu de 100`);
await setS({ extractMessages: 40, extractInputTokens: 3000 });

// ---- 8. via l’interface mobile (2 taps) : texte sous le bouton
await P(() => { globalThis.permanentMemory.store.store.candidates.length = 0; });
await mockClear();
await mock({ queue: ['empty', 'empty'] });
await P(() => globalThis.permanentMemory.ui.openSheet('cand'));
await page.waitForTimeout(600);
await page.locator('[data-act="ai-extract"]').first().tap();
await page.waitForTimeout(500);
await page.locator('[data-act="ai-extract"]').first().tap();
await page.waitForFunction(() => /Causes probables/.test(document.querySelector('#pmem-sheet')?.innerText || ''), null, { timeout: 30000 });
const txt = await P(() => document.querySelector('#pmem-sheet').innerText);
ok(/Extraction non effectuée : Réponse vide de l’IA/.test(txt) && !/No message generated/.test(txt), 'UI : message clair sous le bouton, sans « No message generated »');
await shot(page, '10-extraction-vide');
await page.locator('[data-act="ai-extract"]').first().waitFor();
// vide puis valide via l’UI
await mockClear();
await mock({ queue: ['empty', { text: 'fait|4|Léo possède une épée runique héritée|épée' }] });
await page.locator('[data-act="ai-extract"]').first().tap();
await page.waitForTimeout(500);
await page.locator('[data-act="ai-extract"]').first().tap();
await page.waitForFunction(() => /2ᵉ essai plus court réussi/.test(document.querySelector('#pmem-sheet')?.innerText || ''), null, { timeout: 30000 });
ok(true, 'UI : relance réussie (message « 2ᵉ essai plus court réussi »)');
await shot(page, '11-extraction-relance');

// ---- 9. neverAI : aucun appel
await mockClear();
await setS({ neverAI: true });
await mock({ queue: [] });
await sleep(1000);
ok((await mockLog()).length === 0, 'neverAI : aucun appel');
await setS({ neverAI: false });

ok(errs.length === 0, `Aucune erreur console/page (${errs.length}) ${errs.join(' | ')}`);
await browser.close();
