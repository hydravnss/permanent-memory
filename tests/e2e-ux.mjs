// 1.2.0 : retour visuel des boutons « Extraire avec l’IA » / « 🎬 Résumer » (faux backend avec délai de réponse simulé).
import { boot, connect, selectChar, mock, mockLog, mockClear, shot, ok, sleep } from './lib.mjs';

const { browser, page, errs } = await boot();
await connect(page);
await selectChar(page, 'Seraphina');
const P = (fn, arg) => page.evaluate(fn, arg);
const setS = (patch) => P((p) => { Object.assign(globalThis.permanentMemory.settings(), p); }, patch);
const sheet = () => P(() => document.querySelector('#pmem-sheet')?.innerText || '');
const btn = (k) => page.locator(`[data-act="ai-${k}"]`).first();
const toasts = () => P(() => [...document.querySelectorAll('#toast-container .toast')].map((t) => t.innerText).join(' | '));

await P(() => {
    const c = SillyTavern.getContext();
    c.chat.length = 1;
    const L = [['Léo', 'Marcus, Livia nous a trahis : elle a donné tes lettres au préfet Severus.'], ['Seraphina', 'Alors Gaius devra l’empêcher de recommencer. Elle est devenue trop sûre d’elle.'], ['Léo', 'Je te promets de surveiller Severus.'], ['Seraphina', 'Severus est mon demi-frère, personne ne doit le savoir.']];
    for (const [n, mes] of L) c.chat.push({ name: n === 'Léo' ? c.name1 : n, is_user: n === 'Léo', is_system: false, send_date: Date.now(), mes });
});
await setS({ enabled: true, neverAI: false, autoExtract: false, autoSummary: false, maxCallsPerDay: 50, maxTokensPerMonth: 5000000, autoToInbox: true, minImportance: 3 });
await P(() => { const s = globalThis.permanentMemory.store; s.store.candidates.length = 0; s.store.rejected.length = 0; s.resetStats(); });
await mockClear();
await P(() => globalThis.permanentMemory.ui.openSheet('cand'));
await page.waitForTimeout(600);

// ---- 1. 1er tap : armé + aide ; retour auto après ~8 s ; aucun appel
await btn('extract').tap();
await page.waitForTimeout(400);
let t = await sheet();
ok(/Touche encore pour lancer \(≈ [\d\s\u202f\u00a0]+ tokens\)/.test(await btn('extract').innerText()), '1er tap : « Touche encore pour lancer (≈ N tokens) »');
ok(/Ce 2ᵉ tap enverra 1 requête/.test(t) && /revient à la normale dans 8 s/.test(t), '1er tap : petit texte d’aide');
await shot(page, '30-arme');
await page.waitForTimeout(8300);
ok(/Extraire avec l’IA/.test(await btn('extract').innerText()) && !/Ce 2ᵉ tap/.test(await sheet()), 'Retour auto à l’état normal après ~8 s');
ok((await mockLog()).length === 0, 'Aucun appel sans 2ᵉ tap');

// ---- 2. 2 taps : chargement (spinner, compteur, bouton désactivé, toast), anti double lancement, résultat
const ANS = ['relation|5|Livia a trahi Marcus en livrant ses lettres au préfet Severus.|Livia,Marcus,Severus', 'objectif|4|Marcus veut que Gaius empêche Livia de recommencer, il la juge trop sûre d’elle.|Marcus,Gaius,Livia', 'evenement|4|Seraphina fixa longuement la porte par laquelle Léo avait disparu.|porte', 'fait|2|Léo boit du vin.|vin'].join('\n');
await mock({ queue: [{ text: ANS, delay: 4500 }] });
await btn('extract').tap();
await page.waitForTimeout(300);
await btn('extract').tap();
await page.waitForTimeout(1200);
const b1 = await P(() => { const b = document.querySelector('[data-act="ai-extract"]'); return { txt: b.innerText, dis: b.disabled, spin: !!b.querySelector('.pmem-spin'), anim: getComputedStyle(b.querySelector('.pmem-spin') || b).animationName }; });
ok(b1.dis && /⏳ Extraction en cours…/.test(b1.txt) && b1.spin && b1.anim === 'pmem-rot', `Pendant l’appel : bouton désactivé « ⏳ Extraction en cours… » + spinner animé (${JSON.stringify(b1)})`);
ok(/Extraction lancée/.test(await toasts()), 'Toast « Extraction lancée… »');
ok(/L’IA travaille/.test(await sheet()), 'Statut sous le bouton pendant l’appel');
const s1 = Number((await P(() => document.querySelector('.pmem-secs').innerText)).replace(/\D/g, ''));
await shot(page, '31-chargement');
await page.waitForTimeout(2100);
const s2 = Number((await P(() => document.querySelector('.pmem-secs').innerText)).replace(/\D/g, ''));
ok(s2 >= s1 + 1, `Compteur de secondes qui avance (${s1} s → ${s2} s)`);
ok(await P(() => document.querySelector('[data-act="ai-scene"]').disabled), 'Autre bouton IA désactivé pendant l’appel');
await btn('extract').tap({ force: true }).catch(() => {});
await P(async () => { await globalThis.permanentMemory.engine.runExtraction({ manual: true }); });
await shot(page, '32-chargement-2');
await page.waitForFunction(() => /souvenirs proposés ci-dessous/.test(document.querySelector('#pmem-sheet')?.innerText || ''), null, { timeout: 30000 });
t = await sheet();
ok((await mockLog()).length === 1, `Un seul appel malgré les taps répétés (${(await mockLog()).length})`);
ok(/✅ 2 souvenirs proposés ci-dessous/.test(t) && /2 faits mineurs ignorés/.test(t), 'Fin : « ✅ 2 souvenirs proposés ci-dessous » + « 2 faits mineurs ignorés »');
ok(await page.locator('.pmem-card.cand.pmem-new').count() === 2 && /🆕 Nouveau/.test(t), 'Nouveaux candidats mis en évidence');
ok(/souvenirs proposés/.test(await toasts()), 'Toast de fin');
const kws = await P(() => globalThis.permanentMemory.store.store.candidates.map((c) => c.keywords.join(',')));
ok(!kws.join(',').match(/laquelle|longuement/), `Mots-clés propres (${kws.join(' / ')})`);
await shot(page, '33-resultat');

// ---- 3. relance sur réponse vide : « ⏳ Nouvel essai… »
await mockClear();
await mock({ queue: [{ kind: 'empty', delay: 1500 }, { text: 'fait|4|Severus est le demi-frère secret de Seraphina, personne ne doit le savoir.|Severus,Seraphina,secret', delay: 3500 }] });
await btn('extract').tap(); await page.waitForTimeout(300); await btn('extract').tap();
await page.waitForFunction(() => /Nouvel essai…/.test(document.querySelector('[data-act="ai-extract"]')?.innerText || ''), null, { timeout: 15000 });
ok(true, 'Pendant la relance : « ⏳ Nouvel essai… »');
await shot(page, '34-nouvel-essai');
await page.waitForFunction(() => /souvenir proposé ci-dessous/.test(document.querySelector('#pmem-sheet')?.innerText || ''), null, { timeout: 30000 });
ok(/2ᵉ essai plus court réussi/.test(await sheet()), 'Relance réussie signalée');

// ---- 4. RIEN → « Rien d’important trouvé »
await mockClear();
await mock({ queue: [{ text: 'RIEN', delay: 1000 }] });
await btn('extract').tap(); await page.waitForTimeout(300); await btn('extract').tap();
await page.waitForFunction(() => /Rien d’important trouvé/.test(document.querySelector('#pmem-sheet')?.innerText || ''), null, { timeout: 30000 });
ok(true, 'Réponse RIEN → « Rien d’important trouvé »');
await shot(page, '35-rien');

// ---- 5. erreur → message clair
await mockClear();
await mock({ queue: [{ kind: 'error', delay: 800 }] });
await btn('extract').tap(); await page.waitForTimeout(300); await btn('extract').tap();
await page.waitForFunction(() => /❌ Extraction non effectuée/.test(document.querySelector('#pmem-sheet')?.innerText || ''), null, { timeout: 30000 });
ok(/Erreur de l’API/.test(await sheet()) && !(await P(() => document.querySelector('[data-act="ai-extract"]').disabled)), 'Erreur : message clair, bouton de nouveau utilisable');
await shot(page, '36-erreur');

// ---- 6. 🎬 Résumer : même retour visuel
await mockClear();
await mock({ queue: [{ text: 'Livia a trahi Marcus auprès du préfet Severus. Marcus veut que Gaius l’empêche de recommencer, et Seraphina révèle que Severus est son demi-frère.', delay: 3000 }] });
await btn('scene').tap(); await page.waitForTimeout(300);
ok(/Touche encore pour lancer/.test(await btn('scene').innerText()), 'Résumer : 1er tap armé');
await btn('scene').tap();
await page.waitForTimeout(800);
ok(/⏳ Résumé de la scène en cours…/.test(await btn('scene').innerText()) && await P(() => document.querySelector('[data-act="ai-scene"]').disabled), 'Résumer : chargement + bouton désactivé');
await shot(page, '37-scene-chargement');
await page.waitForFunction(() => /1 souvenir proposé ci-dessous/.test(document.querySelector('#pmem-sheet')?.innerText || ''), null, { timeout: 30000 });
ok(await page.locator('.pmem-card.cand.pmem-new').count() === 1, 'Résumer : nouveau candidat mis en évidence');
await mockClear();
await mock({ queue: [{ text: 'RIEN', delay: 500 }] });
await btn('scene').tap(); await page.waitForTimeout(300); await btn('scene').tap();
await page.waitForFunction(() => /Rien d’important trouvé dans la scène/.test(document.querySelector('#pmem-sheet')?.innerText || ''), null, { timeout: 30000 });
ok(true, 'Résumer : RIEN → « Rien d’important trouvé dans la scène »');

ok(errs.length === 0, `Aucune erreur console/page (${errs.length}) ${errs.join(' | ')}`);
await browser.close();
