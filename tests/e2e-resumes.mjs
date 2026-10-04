// 1.1.0 : souvenirs RÉSUMÉS (prompt reformulé, dédoublonnage), résumé de scène, analyse locale « extrait brut », migration des réglages.
// Prérequis : SillyTavern (http://localhost:8011/) avec l'extension, et `node tests/mock-openai.mjs 9101`.
import { boot, connect, selectChar, mock, mockLog, mockClear, shot, ok } from './lib.mjs';

const { browser, page, errs } = await boot();
await connect(page);
await selectChar(page, 'Seraphina');
const P = (fn, arg) => page.evaluate(fn, arg);
const setS = (patch) => P((p) => { Object.assign(globalThis.permanentMemory.settings(), p); }, patch);
const isExtraction = (r) => (r.messages || []).some((m) => /mémoire à long terme d'un jeu de rôle/.test(String(m.content)));
const isScene = (r) => (r.messages || []).some((m) => /résumes la scène récente/.test(String(m.content)));
const promptText = (r) => (r.messages || []).map((m) => String(m.content)).join('\n');
const sheet = () => P(() => document.querySelector('#pmem-sheet').innerText);
const tap2 = async (sel) => { await page.locator(sel).first().tap(); await page.waitForTimeout(400); await page.locator(sel).first().tap(); };

// ---- chat de jeu de rôle réaliste (en français)
const LINES = [
    ['Léo', "Je m'appelle Léo Durand, je suis forgeron à Valmont depuis dix ans. Je n'ai jamais rencontré quelqu'un d'aussi têtu que toi, Seraphina."],
    ['Seraphina', "*Elle croise les bras.* Têtue ? Je préfère dire déterminée. Et puisque tu me fais confiance, je vais te confier un secret : je suis la fille cachée du roi, et personne à la cour ne doit l'apprendre."],
    ['Léo', "Je te le promets, ce secret restera entre nous. Je te jure que je t'aiderai à reprendre ton trône, quoi qu'il arrive, même si le maire Dorian nous trahit."],
    ['Seraphina', "Dorian... Il finance la bande qui attaque le village, j'en suis certaine. J'ai trouvé une lettre cachée dans sa cave hier soir. J'ai peur, Léo, et je n'arrive pas à dormir depuis."],
    ['Léo', "Nous partirons demain matin avant le lever du soleil vers la forêt de Valmont, là où se trouve la vieille tour de guet. J'adore cet endroit, on y sera en sécurité."],
    ['Seraphina', "D'accord. J'emporte l'épée runique de ma mère, c'est le seul objet qui me reste d'elle. Je déteste le froid, mais pour toi je veux bien dormir dehors."],
];
await P((lines) => {
    const c = SillyTavern.getContext();
    c.chat.length = 1;
    lines.forEach(([name, mes], i) => c.chat.push({ name: name === 'Léo' ? c.name1 : name, is_user: name === 'Léo', is_system: false, send_date: Date.now(), mes }));
}, LINES);
await setS({ enabled: true, neverAI: false, autoExtract: false, autoSummary: false, maxCallsPerDay: 20, maxTokensPerMonth: 5000000, autoMaxTokens: 700, autoMaxItems: 8, extractMessages: 40, extractInputTokens: 4000, sceneMessages: 12, autoToInbox: true, heuristics: false });
await P(() => { const s = globalThis.permanentMemory.store; s.store.candidates.length = 0; s.store.rejected.length = 0; s.resetStats(); });
// un souvenir déjà connu (doit être envoyé en contexte compact et ne pas être re-proposé)
const charKey = await P(() => { const c = SillyTavern.getContext(); return `char:${c.characters[c.characterId].avatar}`; });
await P((k) => { const s = globalThis.permanentMemory.store; s.getList(k, true).length = 0; s.addMemory(k, { text: 'Léo est forgeron à Valmont depuis dix ans.', type: 'fait', importance: 4 }); }, charKey);

// ---- réponse simulée : souvenirs reformulés + 1 doublon de sens + 1 copie du chat (8+ mots) + 1 avec guillemets
const AI_ANSWER = [
    'relation|4|Léo trouve Seraphina très têtue et lui fait pourtant entièrement confiance.|Léo,Seraphina,confiance',
    "fait|5|Seraphina est la fille cachée du roi ; Léo est le seul à connaître ce secret de la cour.|Seraphina,secret,roi",
    'objectif|5|Léo a juré d\'aider Seraphina à reprendre son trône, même en cas de trahison.|Léo,Seraphina,trône,serment',
    'evenement|4|Seraphina a trouvé dans la cave du maire Dorian une lettre prouvant qu\'il finance la bande qui attaque le village.|Dorian,lettre,bande',
    "fait|3|Léo exerce le métier de forgeron à Valmont depuis dix ans.|Léo,forgeron",
    'lieu|3|La vieille tour de guet, dans la forêt de Valmont, sera le refuge où Léo et Seraphina partent demain à l\'aube.|tour de guet,forêt',
    "evenement|2|Nous partirons demain matin avant le lever du soleil vers la forêt de Valmont, là où se trouve la vieille tour de guet.|départ",
    'fait|3|Seraphina dit « je suis la fille cachée du roi » à Léo.|Seraphina',
].join('\n');
const SCENE_ANSWER = "Léo et Seraphina se confient l'un à l'autre : Seraphina révèle qu'elle est la fille cachée du roi et Léo jure de garder le secret et de l'aider à reprendre le trône. Elle redoute le maire Dorian, qui finance en secret la bande attaquant le village. Ils décident de partir à l'aube vers la tour de guet de la forêt de Valmont.";
await mockClear();
await mock({ rules: [{ match: 'résumes la scène récente', text: SCENE_ANSWER }, { match: "mémoire à long terme d'un jeu de rôle", text: AI_ANSWER }] });

// ---- 1. extraction IA : prompt envoyé
const run = () => P(async () => globalThis.permanentMemory.engine.runExtraction({ manual: true }));
let r = await run();
let log = (await mockLog()).filter(isExtraction);
console.log('résultat :', JSON.stringify({ ...r, raw: undefined }));
ok(r.ok && log.length === 1, 'Extraction IA : 1 seul appel');
const sent = promptText(log[0]);
ok(/Souvenirs déjà connus/.test(sent) && /Léo est forgeron à Valmont depuis dix ans/.test(sent), 'Les souvenirs existants sont envoyés en contexte compact (pour ne pas les répéter)');
ok(/troisième personne/.test(sent) && /AUCUNE phrase ni réplique/.test(sent) && /10 à 25 mots/.test(sent) && /relation\|4\|Mara se méfie/.test(sent), 'Le prompt demande des faits courts reformulés à la 3ᵉ personne, interdit les répliques, contient des exemples');
ok(/type\|importance\(1-5\)\|souvenir\|mot-clé1,mot-clé2/.test(sent), 'Format de sortie inchangé (type|importance|souvenir|mots-clés)');

// ---- 2. résultats : dédup + copie signalée
ok(r.found === 8, `8 lignes analysées : ${r.found}`);
ok(r.duplicates >= 1, `Doublon de sens avec un souvenir existant ignoré (${r.duplicates})`);
ok(r.copied === 2, `Copie du chat (phrase de 10+ mots) et guillemets détectées : ${r.copied}`);
const cands = await P(() => globalThis.permanentMemory.store.store.candidates.map((c) => ({ id: c.id, text: c.text, raw: c.raw, origin: c.origin, type: c.type })));
ok(cands.length === 7 - 0 && !cands.some((c) => /exerce le métier/.test(c.text)), `Candidats : ${cands.length} (doublon absent)`);
ok(cands.filter((c) => c.raw === 'copie').length === 2, 'Les 2 copies sont signalées « copie » (à reformuler)');
ok(cands.filter((c) => !c.raw).every((c) => !/[«»"]/.test(c.text) && !/\b(je|tu)\b/i.test(c.text)), 'Candidats propres : 3ᵉ personne, pas de guillemets');

// ---- 3. affichage UI des candidats
await P(() => globalThis.permanentMemory.ui.openSheet('cand'));
await page.waitForTimeout(700);
let txt = await sheet();
ok(/fille cachée du roi/.test(txt) && /Ressemble à une copie du chat, à reformuler/.test(txt), 'UI : candidats reformulés affichés + badge « copie » sur les copies');
ok(await page.locator('.pmem-card.cand.raw').count() === 2 && await page.locator('.pmem-card.cand.raw [data-act="c-ok"]').count() === 0, 'UI : les candidats « copie » n’ont pas de bouton ✓ Garder (seulement ✎ Modifier / ✗ Rejeter)');
ok(/Tout accepter \(sauf bruts\)/.test(txt), 'UI : « Tout accepter (sauf bruts) »');
ok(/seule l|ne sait pas résumer/.test(txt) && /extrait brut, à reformuler/.test(txt), 'UI : explication courte « seule l’IA résume »');
await shot(page, '20-candidats-resumes');

// ---- 4. acceptation
const before = await P((k) => globalThis.permanentMemory.store.getList(k, false).length, charKey);
await page.locator('.pmem-card.cand:not(.raw) [data-act="c-ok"]').first().tap();
await page.waitForTimeout(500);
ok(await P((k) => globalThis.permanentMemory.store.getList(k, false).length, charKey) === before + 1, 'Acceptation d’un candidat → souvenir ajouté');
await page.locator('[data-act="acceptall"]').tap();
await page.waitForTimeout(600);
const after = await P((k) => ({ mem: globalThis.permanentMemory.store.getList(k, false).length, left: globalThis.permanentMemory.store.store.candidates.map((c) => c.raw) }), charKey);
ok(after.mem === before + 1 + 4 && after.left.length === 2 && after.left.every((x) => x === 'copie'), `« Tout accepter » ne prend pas les bruts : ${after.mem} souvenirs, ${after.left.length} brut(s) restant(s)`);
// ✎ Modifier une copie → reformulation → accepté
await page.locator('.pmem-card.cand.raw [data-act="c-edit"]').first().tap();
await page.waitForSelector('#pmem-d-text');
ok(/Extrait brut : reformule-le/.test(await P(() => document.querySelector('#pmem-dialog').innerText)), 'Éditeur : consigne de reformulation sur un extrait brut');
await page.fill('#pmem-d-text', 'Léo et Seraphina quittent le village à l’aube pour rejoindre la tour de guet.');
await page.locator('#pmem-d-save').tap();
await page.waitForTimeout(600);
ok(await P((k) => globalThis.permanentMemory.store.getList(k, false).some((m) => /quittent le village à l’aube/.test(m.text)), charKey) && await P(() => globalThis.permanentMemory.store.store.candidates.length === 1), 'Copie reformulée via ✎ Modifier → acceptée');

// ---- 5. dédup : relancer la même extraction n’ajoute rien de nouveau
await P(() => { globalThis.permanentMemory.store.store.candidates.length = 0; });
await mockClear(); await mock({ rules: [{ match: "mémoire à long terme d'un jeu de rôle", text: AI_ANSWER }] });
r = await run();
const sent2 = promptText((await mockLog()).filter(isExtraction)[0]);
ok(r.ok && r.added <= 2 && r.duplicates >= 5, `Relance : déjà connus ignorés (${r.duplicates} doublons, ${r.added} ajouté(s), dont les 2 copies/quotes)`);
ok(/Souvenirs déjà connus/.test(sent2) && /fille cachée du roi/.test(sent2), 'Les souvenirs acceptés repartent en contexte (« déjà connus »)');

// ---- 6. résumé de scène
await P(() => { globalThis.permanentMemory.store.store.candidates.length = 0; globalThis.permanentMemory.store.resetStats(); });
await mockClear(); await mock({ rules: [{ match: 'résumes la scène récente', text: SCENE_ANSWER }] });
await P(() => globalThis.permanentMemory.ui.openSheet('cand'));
await page.waitForTimeout(500);
ok(await page.locator('[data-act="ai-scene"]').count() === 1, 'UI : bouton « Résumer les derniers messages »');
await page.locator('[data-act="ai-scene"]').first().tap();
await page.waitForTimeout(500);
ok((await mockLog()).length === 0, 'Résumé de scène : 1er tap = estimation seulement, aucun appel');
ok(/Confirmer \? \(≈ [\d\s\u202f\u00a0,]+ tokens\)/.test(await page.locator('[data-act="ai-scene"]').first().innerText()), 'Résumé de scène : confirmation de coût affichée');
await page.locator('[data-act="ai-scene"]').first().tap();
await page.waitForFunction(() => /Résumé de la scène \(/.test(document.querySelector('#pmem-sheet')?.innerText || ''), null, { timeout: 30000 });
log = (await mockLog()).filter(isScene);
ok(log.length === 1 && (await mockLog()).length === 1, 'Résumé de scène : exactement 1 appel IA');
ok(/2 à 4 phrases/.test(promptText(log[0])) && /Seraphina: /.test(promptText(log[0])), 'Prompt de scène envoyé (2 à 4 phrases + messages)');
const sc = await P(() => globalThis.permanentMemory.store.store.candidates.map((c) => ({ text: c.text, type: c.type, raw: c.raw, scope: c.scope, origin: c.origin })));
ok(sc.length === 1 && sc[0].type === 'evenement' && !sc[0].raw && /fille cachée du roi/.test(sc[0].text) && sc[0].scope === charKey, `1 candidat unique de type événement (${sc.length}) : ${sc[0]?.text.slice(0, 60)}…`);
ok(await P(() => globalThis.permanentMemory.settings().stats.callsToday === 1), 'Le résumé de scène compte dans le plafond d’appels');
await shot(page, '21-resume-scene');
await page.locator('.pmem-card.cand [data-act="c-ok"]').first().tap();
await page.waitForTimeout(400);
ok(await P((k) => globalThis.permanentMemory.store.getList(k, false).some((m) => m.type === 'evenement' && /Dorian/.test(m.text)), charKey), 'Résumé de scène accepté → souvenir « événement »');
// plafond respecté
await setS({ maxCallsPerDay: 1 });
await mockClear();
const rc = await P(async () => globalThis.permanentMemory.engine.runSceneSummary());
ok(!rc.ok && /Plafond quotidien/.test(rc.reason) && (await mockLog()).length === 0, 'Plafond journalier respecté pour le résumé de scène (aucun appel)');
await setS({ maxCallsPerDay: 20 });
// réponse vide → message clair, pas de 2ᵉ appel
await mockClear(); await mock({ rules: [], queue: ['empty'] });
const re = await P(async () => globalThis.permanentMemory.engine.runSceneSummary());
ok(!re.ok && re.empty && /Réponse vide/.test(re.reason) && (await mockLog()).length === 1, 'Résumé de scène : réponse vide → message clair, un seul appel');

// ---- 7. analyse locale : faits structurés vs extraits bruts
await P(() => { globalThis.permanentMemory.store.store.candidates.length = 0; });
await mock({ rules: [], queue: [] });
await mockClear();
await P(() => globalThis.permanentMemory.ui.openSheet('cand'));
await page.waitForTimeout(400);
await page.locator('[data-act="scan"]').tap();
await page.waitForTimeout(800);
const loc = await P(() => globalThis.permanentMemory.store.store.candidates.map((c) => ({ text: c.text, raw: c.raw, origin: c.origin })));
console.log('locaux :', JSON.stringify(loc));
ok(loc.length > 0 && loc.every((c) => c.origin === 'local'), `Analyse locale : ${loc.length} candidat(s) local(aux)`);
ok(loc.some((c) => !c.raw && /^Léo adore cet endroit|Seraphina déteste le froid|Le nom complet de/.test(c.text)) || loc.some((c) => !c.raw), 'Analyse locale : au moins un fait structuré reformulé (3ᵉ personne)');
ok(loc.filter((c) => !c.raw).every((c) => !/\b(je|j'|tu|te)\b/i.test(c.text)), 'Faits structurés : jamais de phrase brute à la 1ʳᵉ personne');
ok(loc.filter((c) => c.raw).length >= 1 && loc.filter((c) => c.raw).every((c) => c.raw === 'extrait'), 'Phrases brutes marquées « extrait »');
txt = await sheet();
ok(/Extrait brut, à reformuler/.test(txt) && /seule l’IA|ne sait pas résumer/.test(txt), 'UI : « extrait brut, à reformuler » + explication visible');
ok(await page.locator('.pmem-card.cand.raw [data-act="c-edit"]').count() >= 1 && await page.locator('.pmem-card.cand.raw [data-act="c-ok"]').count() === 0, 'UI : les extraits bruts proposent ✎ Modifier (pas ✓ Garder)');
await shot(page, '22-analyse-locale');
ok((await mockLog()).length === 0, 'Analyse locale : 0 appel IA');
// détection automatique (nouveau message) : jamais de phrase brute
await P(() => { globalThis.permanentMemory.store.store.candidates.length = 0; });
await setS({ heuristics: true });
const nAuto = await P(() => {
    const c = SillyTavern.getContext();
    globalThis.permanentMemory.engine.initChatCursors();
    c.chat.push({ name: c.name1, is_user: true, is_system: false, send_date: Date.now(), mes: "Je te promets de revenir le 12 mars. Je suis allergique aux noix, tu sais." });
    const n = globalThis.permanentMemory.engine.scanNew();
    return { n, list: globalThis.permanentMemory.store.store.candidates.map((x) => [x.raw, x.text]) };
});
ok(nAuto.list.length >= 1 && nAuto.list.every(([raw]) => !raw), `Détection automatique : faits structurés seulement (${JSON.stringify(nAuto.list)})`);
await setS({ heuristics: false });

// ---- 8. migration des réglages
const mig = await P(() => {
    const es = SillyTavern.getContext().extensionSettings;
    const S = globalThis.permanentMemory.settings;
    const run = (patch) => { const e = es.permanent_memory; for (const k of ['maxCallsPerDay', 'autoMaxItems', 'autoMaxTokens', 'extractInputTokens', 'preset']) delete e[k]; Object.assign(e, { settingsVersion: 2 }, patch); const s = S(); return [s.maxCallsPerDay, s.autoMaxItems, s.autoMaxTokens, s.extractInputTokens, s.settingsVersion]; };
    return {
        old: run({ maxCallsPerDay: 2, autoMaxItems: 4, autoMaxTokens: 400, extractInputTokens: 3000, preset: 'equilibre' }),
        custom: run({ maxCallsPerDay: 3, autoMaxItems: 6, autoMaxTokens: 900, extractInputTokens: 2500, preset: 'custom' }),
        ten: run({ maxCallsPerDay: 10, preset: 'confort' }),
        eco: run({ maxCallsPerDay: 2, preset: 'economie' }),
        fresh: run({}),
        again: run({ settingsVersion: 3, maxCallsPerDay: 2, preset: 'custom' }),
    };
});
console.log('migration :', JSON.stringify(mig));
ok(JSON.stringify(mig.old) === '[5,8,700,4000,3]', 'Migration : 2 / 4 / 400 / 3000 (anciens défauts) → 5 / 8 / 700 / 4000');
ok(mig.custom[0] === 3 && mig.custom[1] === 6 && mig.custom[2] === 900 && mig.custom[3] === 2500, 'Migration : valeurs personnalisées conservées');
ok(mig.ten[0] === 10, 'Migration : plafond 10 conservé');
ok(mig.eco[0] === 2, 'Migration : préréglage Économie (2 volontaire) conservé');
ok(mig.fresh[0] === 5 && mig.fresh[1] === 8, 'Nouveau réglage : plafond 5 par défaut');
ok(mig.again[0] === 2, 'Pas de re-migration une fois en version 3');
await setS({ maxCallsPerDay: 20, preset: 'equilibre' });

ok(errs.length === 0, `Aucune erreur console/page (${errs.length}) ${errs.join(' | ')}`);
await browser.close();
