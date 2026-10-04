// Tests de bout en bout : vrai SillyTavern (WebKit iPhone 14 Pro) + faux backend OpenAI.
import { boot, connect, selectChar, say, idle, lastPrompt, mock, mockLog, mockClear, shot, ok, sleep, ensureBobAndGroup, ST } from './lib.mjs';

const { browser, page, errs } = await boot();
await connect(page);
const ids = await ensureBobAndGroup(page);
const P = (fn, arg) => page.evaluate(fn, arg);
const slash = (cmd) => P((c) => SillyTavern.getContext().executeSlashCommandsWithOptions(c), cmd);
const setS = (patch) => P((p) => { Object.assign(globalThis.permanentMemory.settings(), p); }, patch);
const chatId = () => P(() => SillyTavern.getContext().getCurrentChatId());
const block = async () => { const p = await lastPrompt(); const m = p.match(/\[Mémoire de [^\n]*\n[\s\S]*?\n\]/); return m ? m[0] : ''; };
const reqCount = async () => (await mockLog()).length;
const isExtractionReq = (r) => (r.messages || []).some((m) => /mémoire à long terme d'un jeu de rôle/.test(String(m.content)));
const isSummaryReq = (r) => (r.messages || []).some((m) => /tiens le résumé/.test(String(m.content)));
const storeFile = async () => (await fetch(`${ST}user/files/permanent_memory_store.json?t=${Date.now()}`)).json();
const fileCall = async (text) => (await fetch(`${ST}user/files/permanent_memory_store.json?t=${Date.now()}`)).text();
const memTexts = (key) => P((k) => globalThis.permanentMemory.store.getList(k, false).map((m) => m.text), key);

// ---- départ propre
await P(async () => { const s = globalThis.permanentMemory.store; s.store.scopes = {}; s.store.candidates = []; s.store.rejected = []; await s.saveStoreNow(); });
await setS({ enabled: true, maxTokens: 400, maxMemories: 6, minScore: 0.5, scanDepth: 4, neverAI: false, autoExtract: false, autoSummary: false, heuristics: true, includeChat: true, useWorld: true, usePersona: false, groupAllMembers: false, position: 1, depth: 4, role: 0, maxCallsPerDay: 5, maxTokensPerMonth: 30000, autoEvery: 4, floating: false });
await P(() => globalThis.permanentMemory.store.resetStats());
await mockClear();

// =============================================================== 1. Création + persistance entre chats
await selectChar(page, 'Seraphina');
const chat1 = await chatId();
await slash('/mem add Léo déteste les araignées depuis son enfance');
await slash('/mem add type=objectif imp=4 Seraphina a promis de ramener le dragon blanc à Léo');
await slash('/mem add Le royaume de Valmont est en guerre contre le nord');
await slash("/mem add Le chat de la voisine s'appelle Moka");
await slash('/mem add pin=true imp=5 Règle d’or : Seraphina tutoie toujours Léo');
await slash('/mem add scope=chat Dans ce chat précis Léo porte une cape rouge brodée');
await slash('/mem add scope=monde La lune d’argent se lève toutes les trois nuits');
let sera = await memTexts(`char:${ids.sera}`);
ok(sera.length === 5, `5 souvenirs pour Seraphina via /mem add (${sera.length})`);
ok((await memTexts('chat')).length === 1, '1 souvenir propre au chat');
await sleep(1500);
let f = await storeFile();
ok(f.scopes[`char:${ids.sera}`]?.memories.length === 5 && f.scopes.world?.memories.length === 1, 'Fichier serveur permanent_memory_store.json écrit (clé = avatar du perso)');
ok(!JSON.stringify(f).includes('cape rouge'), 'Le souvenir « chat » n’est PAS dans le fichier global (il est dans le chat)');
const listOut = await slash('/mem list');
ok(String(listOut?.pipe ?? listOut).includes('araignées'), '/mem list retourne les souvenirs');
await shot(page, '01-liste-souvenirs');
await P(() => globalThis.permanentMemory.ui.closeSheet());

// nouveau chat du même perso
await slash('/newchat');
await page.waitForTimeout(2500);
const chat2 = await chatId();
ok(chat1 !== chat2, `Nouveau chat différent (${chat1} → ${chat2})`);
sera = await memTexts(`char:${ids.sera}`);
ok(sera.length === 5, 'Les 5 souvenirs du perso sont toujours là dans le nouveau chat');
ok((await memTexts('chat')).length === 0, 'Le souvenir propre au premier chat est absent du nouveau chat');

// =============================================================== 2. Injection pertinente, budget, épinglés
await mockClear();
await say(page, 'Il y a une araignée dans la chambre !');
let b = await block();
console.log('--- bloc injecté ---\n' + b + '\n---');
ok(b.includes('araignées'), 'Injection: souvenir pertinent (araignées) présent');
ok(b.includes('Règle d’or'), 'Injection: souvenir épinglé présent');
ok(!b.includes('Moka') && !b.includes('Valmont') && !b.includes('dragon blanc'), 'Injection: souvenirs hors-sujet ABSENTS');
ok(b.includes('lune d’argent') === false, 'Injection: souvenir monde non pertinent absent');
const li = await P(() => globalThis.permanentMemory.engine.state.lastInjection);
ok(li.tokens > 0 && li.tokens <= 400, `Tokens injectés ${li.tokens} ≤ budget 400`);
const prompt1 = (await mockLog()).at(-1).messages;
const idxInj = prompt1.findIndex((m) => String(m.content).includes('[Mémoire de'));
ok(idxInj > 0 && idxInj >= prompt1.length - 6, `Bloc injecté dans le chat à la profondeur 4 (message ${idxInj + 1}/${prompt1.length}), pas en tête de prompt`);
ok((await reqCount()) === 1, 'Une seule requête API pour un message (aucun appel mémoire)');

await mockClear();
await setS({ scanDepth: 1 });
await say(page, 'Parle-moi du royaume de Valmont.');
b = await block();
ok(b.includes('Valmont') && !b.includes('araignées') && !b.includes('Moka'), 'Changement de sujet (analyse du dernier message seul): Valmont injecté, araignées retirées');
await setS({ scanDepth: 4 });
ok(b.includes('Règle d’or'), 'Épinglé toujours là au 2e message');
ok((await reqCount()) === 1, 'Toujours une seule requête');

// pertinence par accent/pluriel/FR
await mockClear();
await say(page, 'Mon petit dragon blanc dort où ?');
b = await block();
ok(b.includes('dragon blanc'), 'Tokenisation légère (dragon blanc) trouvée');

// budget serré
await setS({ maxTokens: 60, maxMemories: 2 });
await mockClear();
await say(page, 'Araignée, Valmont, dragon, Moka, tout en même temps !');
const li2 = await P(() => globalThis.permanentMemory.engine.state.lastInjection);
ok(li2.tokens <= 60, `Budget serré: ${li2.tokens} tokens ≤ 60`);
ok(li2.warnings.length > 0, `Avertissement affiché (${li2.warnings[0]})`);
ok(li2.picked.some((p) => p.pinned), 'Épinglé gardé même avec budget serré');
await setS({ maxTokens: 400, maxMemories: 6 });

// =============================================================== 3. Mode « jamais d’IA » + 0 requête
await setS({ neverAI: true, autoExtract: true, autoSummary: true, autoEvery: 2, summaryEvery: 10 });
await mockClear();
await P(() => { globalThis.permanentMemory.engine.initChatCursors(); const cd = globalThis.permanentMemory.store.chatData(true); cd.lastExtractIdx = -1; cd.lastSummaryIdx = -1; });
await say(page, 'Je m’appelle Léo et je te promets de revenir à Valmont demain soir.');
await say(page, 'Raconte-moi une histoire, vite.');
await sleep(3500);
let log = await mockLog();
ok(log.length === 2 && !log.some(isExtractionReq) && !log.some(isSummaryReq), `Mode jamais d’IA: ${log.length} requêtes = 2 messages, 0 appel mémoire`);
const r1 = await P(() => globalThis.permanentMemory.engine.runExtraction({ manual: true }));
const r2 = await P(() => globalThis.permanentMemory.engine.runSummary({ manual: true }));
ok(!r1.ok && !r2.ok && (await reqCount()) === 2, `Appels manuels refusés (« ${r1.reason} »), toujours 2 requêtes`);
const cand = await P(() => globalThis.permanentMemory.store.store.candidates.map((c) => ({ t: c.text, o: c.origin, ty: c.type })));
ok(cand.some((c) => /promets|appelle/i.test(c.t) && c.o === 'heuristique'), `Détection locale: ${cand.length} candidat(s) sans IA (${cand.map((c) => c.ty).join(',')})`);
const blocked = await P(() => globalThis.permanentMemory.settings().stats.blocked);
ok(blocked >= 2, `Compteur d’appels refusés = ${blocked}`);
await shot(page, '02-candidats');

// =============================================================== 4. Extraction auto groupée, plafond quotidien
await setS({ neverAI: false, autoExtract: true, autoSummary: false, autoEvery: 4, maxCallsPerDay: 2, autoMaxTokens: 150 });
await P(() => globalThis.permanentMemory.store.resetStats());
await P(() => { const sm = globalThis.permanentMemory; sm.store.store.candidates.length = 0; sm.engine.initChatCursors(); const cd = sm.store.chatData(true); cd.lastExtractIdx = SillyTavern.getContext().chat.length - 1; });
await mockClear();
const EXTRACT = 'fait|4|Léo est forgeron à Valmont|Léo,forgeron\nrelation|5|Seraphina est secrètement amoureuse de Léo|Seraphina,Léo\nRIEN';
await mock({ queue: ['ok', 'ok', { text: EXTRACT }] });
await say(page, 'Premier message de test sans rien de spécial.');
await sleep(2500);
log = await mockLog();
ok(log.length === 1 && !log.some(isExtractionReq), 'Après 2 messages (N=4) : aucun appel d’extraction');
await say(page, 'Deuxième message tranquille aussi.');
await sleep(4000);
log = await mockLog();
ok(log.filter(isExtractionReq).length === 1 && log.length === 3, `Après 4 messages : EXACTEMENT 1 appel d’extraction (total ${log.length})`);
const exReq = log.find(isExtractionReq);
ok(JSON.stringify(exReq.messages).length < 3500, `Prompt d’extraction court (${JSON.stringify(exReq.messages).length} caractères)`);
let iaC = await P(() => globalThis.permanentMemory.store.store.candidates.filter((c) => c.origin === 'ia').map((c) => c.text));
ok(iaC.length === 2, `2 candidats IA dans la boîte (${iaC.join(' | ')})`);
let stt = await P(() => ({ ...globalThis.permanentMemory.settings().stats }));
ok(stt.callsToday === 1 && stt.tokensToday > 0, `Compteur: ${stt.callsToday} appel, ≈${stt.tokensToday} tokens`);
// intervalle suivant
await mock({ queue: ['ok', 'ok', { text: 'preference|3|Léo adore le thé au jasmin|thé' }] });
await say(page, 'Troisième.'); await say(page, 'Quatrième.');
await sleep(4000);
log = await mockLog();
ok(log.filter(isExtractionReq).length === 2, `2e intervalle : 2 appels d’extraction au total (${log.filter(isExtractionReq).length})`);
// plafond atteint
await mock({ queue: [] });
await say(page, 'Cinquième.'); await say(page, 'Sixième.');
await sleep(4000);
log = await mockLog();
ok(log.filter(isExtractionReq).length === 2, `Plafond 2 appels/jour respecté : toujours ${log.filter(isExtractionReq).length} appels d’extraction`);
stt = await P(() => ({ ...globalThis.permanentMemory.settings().stats }));
ok(stt.callsToday === 2 && stt.blocked >= 1, `Compteurs: ${stt.callsToday}/2 appels, ${stt.blocked} refus`);
await setS({ autoExtract: false });

// =============================================================== 5. Boîte de candidats (UI tactile)
await P(() => globalThis.permanentMemory.ui.openSheet('cand'));
await page.waitForTimeout(400);
await shot(page, '03-candidats-ia');
const before = (await memTexts(`char:${ids.sera}`)).length;
await page.locator('#pmem-body .pmem-card.cand', { hasText: 'forgeron' }).locator('[data-act="c-ok"]').tap();
await page.waitForTimeout(400);
let after = await memTexts(`char:${ids.sera}`);
ok(after.length === before + 1 && after.some((t) => t.includes('forgeron')), 'Candidat accepté d’un tap → devient un souvenir du perso');
await page.locator('#pmem-body .pmem-card.cand', { hasText: 'amoureuse' }).locator('[data-act="c-no"]').tap();
await page.waitForTimeout(400);
ok(!(await P(() => globalThis.permanentMemory.store.store.candidates.some((c) => /amoureuse/.test(c.text)))), 'Candidat rejeté disparaît');
ok((await P(() => globalThis.permanentMemory.store.addCandidate({ text: 'Seraphina est secrètement amoureuse de Léo', scope: 'char:default_Seraphina.png' }))) === null, 'Un candidat rejeté n’est pas re-proposé');
await P(() => globalThis.permanentMemory.ui.closeSheet());

// =============================================================== 6. Résumé glissant (1 appel)
await setS({ summaryMaxTokens: 120, maxCallsPerDay: 10 });
await P(() => globalThis.permanentMemory.store.resetStats());
await mockClear();
await mock({ queue: [{ text: 'Léo et Seraphina discutent de Valmont ; elle a promis de ramener le dragon blanc.' }] });
const rs = await P(() => globalThis.permanentMemory.engine.runSummary({ manual: true }));
log = await mockLog();
ok(rs.ok && log.length === 1 && isSummaryReq(log[0]), `Résumé: exactement 1 appel (${rs.reason || 'ok'})`);
const sm = await P(() => globalThis.permanentMemory.store.chatData(true).memories.filter((m) => m.summary).map((m) => ({ t: m.text, p: m.pinned, ty: m.type })));
ok(sm.length === 1 && sm[0].p && sm[0].ty === 'resume', 'Le résumé est UN souvenir épinglé de type résumé');
await mock({ queue: [{ text: 'Résumé mis à jour : Léo est forgeron.' }] });
await P(() => { const cd = globalThis.permanentMemory.store.chatData(true); });
await say(page, 'Encore un message.'); // ajoute du contenu
await mock({ queue: [{ text: 'Résumé V2 : Léo est forgeron à Valmont.' }] });
await P(() => globalThis.permanentMemory.engine.runSummary({ manual: true }));
ok((await P(() => globalThis.permanentMemory.store.chatData(true).memories.filter((m) => m.summary).length)) === 1, 'Mise à jour du résumé = toujours un seul souvenir');
await mockClear();
await say(page, 'Quoi de neuf ?');
ok((await block()).includes('Résumé V2'), 'Le résumé est injecté (épinglé)');

// =============================================================== 7. Persona / Monde
await slash('/mem add scope=persona Le persona Léo est gaucher et porte une bague');
await setS({ usePersona: true });
await mockClear();
await say(page, 'Regarde ma bague, je suis gaucher.');
b = await block();
ok(b.includes('gaucher'), 'Souvenir du persona injecté quand activé et pertinent');
await setS({ usePersona: false });
await mockClear();
await say(page, 'La lune d’argent brille, cette nuit.');
b = await block();
ok(b.includes('lune d’argent'), 'Souvenir « Monde » injecté (pertinent)');

// =============================================================== 8. Groupe : isolation par personnage (réglage optionnel « groupAllMembers » décoché)
await P(async (gid) => { const g = await import('/scripts/group-chats.js'); await g.openGroupById(gid); }, ids.gid);
await page.waitForTimeout(2500);
await slash('/mem add scope=Bob Bob cache une clé dorée sous son enclume');
await slash('/mem add scope=groupe Le groupe a juré de protéger le phare de Valmont');
await slash('/mem add scope=monde Un orage magique gronde sur la falaise');
const gen = (chidName) => P(async (n) => { const c = SillyTavern.getContext(); const i = c.characters.findIndex((x) => x.name === n); await c.generate('normal', { force_chid: i }); }, chidName);
await P(() => { $('#send_textarea').val('Bob, montre la clé sous l’enclume. Seraphina, tu as peur de l’araignée ? Et le phare, l’orage ?').trigger('input'); });
await mockClear();
await P(async () => { const c = SillyTavern.getContext(); const i = c.characters.findIndex((x) => x.name === 'Bob'); const t = $('#send_textarea').val(); $('#send_textarea').val(''); await c.executeSlashCommandsWithOptions('/send ' + t); await c.generate('normal', { force_chid: i }); });
await idle(page);
b = await block();
console.log('--- groupe/Bob ---\n' + b);
ok(b.includes('clé dorée'), 'Groupe, Bob parle : sa mémoire (clé dorée) injectée');
ok(!b.includes('araignées'), 'Groupe, Bob parle : mémoire de Seraphina NON injectée');
ok(b.includes('phare') && b.includes('orage'), 'Groupe: mémoires « groupe » et « monde » injectées');
await mockClear();
await P(async () => { const c = SillyTavern.getContext(); const i = c.characters.findIndex((x) => x.name === 'Seraphina'); await c.generate('normal', { force_chid: i }); });
await idle(page);
b = await block();
ok(b.includes('araignées') && !b.includes('clé dorée'), 'Groupe, Seraphina parle : sa mémoire oui, celle de Bob non');
ok(b.includes('(Seraphina)') || /\(Seraphina\)/.test(b), 'Lignes étiquetées par personnage en groupe');
await setS({ groupAllMembers: true });
await mockClear();
await P(async () => { const c = SillyTavern.getContext(); const i = c.characters.findIndex((x) => x.name === 'Seraphina'); await c.generate('normal', { force_chid: i }); });
await idle(page);
b = await block();
ok(b.includes('araignées') && b.includes('clé dorée'), 'Mode « tous les présents » : les deux mémoires');
await setS({ groupAllMembers: false });
await shot(page, '04-groupe');
// chat solo avec Bob : pas de fuite
await selectChar(page, 'Bob');
await mockClear();
await say(page, 'Une araignée, une clé dorée sous l’enclume, et Valmont !');
b = await block();
ok(b.includes('clé dorée') && !b.includes('araignées') && !b.includes('Valmont est en guerre'), 'Chat solo Bob : seulement la mémoire de Bob (+ monde), rien de Seraphina');
ok(!b.includes('phare'), 'Chat solo Bob : pas la mémoire du groupe');

// =============================================================== 9. Import / export / sauvegarde
await selectChar(page, 'Seraphina');
const exp = await P(() => JSON.parse(JSON.stringify(globalThis.permanentMemory.store.exportData(null))));
const nBefore = Object.values(exp.scopes).reduce((a, s) => a + s.memories.length, 0);
await P(() => { const s = globalThis.permanentMemory.store; s.store.scopes = {}; });
ok((await memTexts(`char:${ids.sera}`)).length === 0, 'Store vidé pour le test d’import');
const fs = await import('node:fs');
fs.writeFileSync('/tmp/mem-export.json', JSON.stringify(exp));
await P(() => globalThis.permanentMemory.ui.openSheet('tools'));
await page.waitForTimeout(300);
await page.setInputFiles('#pmem-file', '/tmp/mem-export.json');
await page.waitForTimeout(900);
const exp2 = await P(() => JSON.parse(JSON.stringify(globalThis.permanentMemory.store.exportData(null))));
const nAfter = Object.values(exp2.scopes).reduce((a, s) => a + s.memories.length, 0);
const same = Object.keys(exp.scopes).every((k) => JSON.stringify(exp.scopes[k].memories.map((m) => [m.id, m.text, m.importance, m.pinned])) === JSON.stringify((exp2.scopes[k]?.memories || []).map((m) => [m.id, m.text, m.importance, m.pinned])));
ok(nAfter === nBefore && same, `Import/export aller-retour identique (${nBefore} → ${nAfter} souvenirs, mêmes ids)`);
// import en fusion = idempotent
const rimp = await P((e) => globalThis.permanentMemory.store.importData(e, 'fusion'), exp);
ok(rimp.added === 0, 'Ré-import (fusion) n’ajoute aucun doublon');
await shot(page, '05-outils');
const bk = await P(() => globalThis.permanentMemory.store.backupToServer());
const bkRes = await fetch(`${ST}user/files/${bk}`);
ok(bkRes.ok, `Sauvegarde serveur créée (${bk})`);
await P(() => globalThis.permanentMemory.ui.closeSheet());

// =============================================================== 10. Doublons + archivage
await P(() => { const s = globalThis.permanentMemory.store; s.addMemory('world', { text: 'La lune d’argent se lève toutes les trois nuits environ' }); });
const dups = await P(() => globalThis.permanentMemory.engine.duplicatesIn('world').map((d) => d.score));
ok(dups.length === 1, `Doublon proche détecté (Jaccard ${dups[0]})`);
await P(() => { const e = globalThis.permanentMemory.engine; const d = e.duplicatesIn('world')[0]; if (d) e.mergeDuplicate('world', d.a.id, d.b.id); });
ok((await P(() => globalThis.permanentMemory.engine.duplicatesIn('world').length)) === 0 && (await memTexts('world')).filter((t) => t.includes('lune')).length === 1, 'Fusion: un seul souvenir restant');
await P(() => { const s = globalThis.permanentMemory.store; const r = s.addMemory(`char:default_Seraphina.png`, { text: 'Vieille anecdote sans importance sur un marchand ambulant', importance: 1, created: Date.now() - 200 * 86400000 }); window.__oldId = r.entry.id; });
const na = await P(() => globalThis.permanentMemory.engine.runArchive({ force: true }));
ok(na >= 1, `Archivage auto: ${na} souvenir(s) archivé(s), rien de supprimé`);
await mockClear();
await say(page, 'Parle du marchand ambulant.');
ok(!(await block()).includes('marchand'), 'Un souvenir archivé n’est pas injecté');
ok((await memTexts(`char:${ids.sera}`)).some((t) => t.includes('marchand')), 'Le souvenir archivé existe toujours');

// =============================================================== 11. Interface iPhone
const vp = page.viewportSize();
await P(() => globalThis.permanentMemory.ui.closeSheet());
await page.locator('#extensionsMenuButton').tap();
await page.waitForTimeout(300);
ok(await page.locator('#pmem_wand_button').isVisible(), 'Entrée « 🧠 Mémoire » visible dans le menu baguette');
await page.locator('#pmem_wand_button').tap();
await page.waitForTimeout(500);
ok(await page.locator('#pmem-sheet.pmem-open').isVisible(), 'Tap sur l’entrée baguette → panneau ouvert');
await shot(page, '06-panneau-souvenirs');
const geo = await P(() => { const p = document.querySelector('#pmem-sheet .pmem-panel').getBoundingClientRect(); const body = document.querySelector('#pmem-body'); return { w: p.width, vw: innerWidth, sw: body.scrollWidth, cw: body.clientWidth }; });
ok(geo.w <= geo.vw + 1 && geo.sw <= geo.cw + 1, `Pas de débordement horizontal (panneau ${geo.w}/${geo.vw}, contenu ${geo.sw}/${geo.cw})`);
const small = await P(() => [...document.querySelectorAll('#pmem-sheet button, #pmem-sheet select, #pmem-sheet input')].filter((e) => e.offsetParent && !e.hidden).map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, t: (e.textContent || e.id || '').slice(0, 16) }; }).filter((x) => x.h < 30));
ok(small.length === 0, `Cibles tactiles ≥ 30px de haut (${small.length} trop petites ${JSON.stringify(small.slice(0, 3))})`);
// recherche + filtre
await page.fill('#pmem-q', 'araign');
await page.waitForTimeout(300);
ok((await page.locator('#pmem-body .pmem-card').count()) === 1, 'Recherche « araign » → 1 résultat');
await page.fill('#pmem-q', '');
await page.waitForTimeout(300);
await page.selectOption('#pmem-ftype', 'objectif');
await page.waitForTimeout(300);
ok((await page.locator('#pmem-body .pmem-card').count()) === 1, 'Filtre type « objectif » → 1 résultat');
await page.selectOption('#pmem-ftype', '');
await page.waitForTimeout(300);
// étoiles + épingle + édition au tap
const card = page.locator('#pmem-body .pmem-card', { hasText: 'Moka' });
await card.locator('.pmem-star').nth(4).tap();
await page.waitForTimeout(300);
ok((await P(() => globalThis.permanentMemory.store.getList('char:default_Seraphina.png').find((m) => m.text.includes('Moka')).importance)) === 5, 'Étoiles: importance 5 via tap');
await page.locator('#pmem-body .pmem-card', { hasText: 'Moka' }).locator('[data-act="pin"]').tap();
await page.waitForTimeout(300);
ok(await P(() => globalThis.permanentMemory.store.getList('char:default_Seraphina.png').find((m) => m.text.includes('Moka')).pinned), 'Épingle via tap');
await page.locator('#pmem-body .pmem-card', { hasText: 'Moka' }).locator('.pmem-text').tap();
await page.waitForTimeout(400);
await shot(page, '07-editeur');
await page.fill('#pmem-d-text', "Le chat de la voisine s'appelle Moka et il adore le poisson");
await page.locator('#pmem-d-save').tap();
await page.waitForTimeout(500);
ok((await memTexts('char:default_Seraphina.png')).some((t) => t.includes('adore le poisson')), 'Édition du texte enregistrée');
await page.locator('#pmem-body .pmem-card', { hasText: 'Moka' }).locator('[data-act="pin"]').tap();
// onglets
for (const [tab, name] of [['inj', '08-injection'], ['cost', '09-cout'], ['tools', '10-outils']]) {
    await page.locator(`#pmem-tabs [data-tab="${tab}"]`).tap();
    await page.waitForTimeout(700);
    await shot(page, name);
}
// simulation (gratuit)
await page.locator('#pmem-tabs [data-tab="inj"]').tap();
await page.fill('#pmem-sim', 'Une araignée !');
await page.locator('[data-act="sim"]').tap();
await page.waitForTimeout(600);
ok((await page.locator('#pmem-preview').innerText()).includes('araignées'), 'Simulation: l’aperçu montre le bloc pour un message donné');
ok((await reqCount()) === 1, 'Simulation/aperçu: aucun appel API (1 seule requête du dernier message)');
// bouton IA à 2 temps (jamais d'appel au 1er tap)
await page.locator('#pmem-tabs [data-tab="cand"]').tap();
await page.waitForTimeout(400);
const c0 = await reqCount();
await page.locator('[data-act="ai-extract"]').tap();
await page.waitForTimeout(600);
ok((await reqCount()) === c0 && (await page.locator('.pmem-armed').count()) === 1, 'Bouton IA: 1er tap = estimation seulement (aucune requête), 2e tap nécessaire');
await shot(page, '11-confirmation-ia');
await page.waitForTimeout(6500);
await P(() => globalThis.permanentMemory.ui.closeSheet());

// bouton « Mémoriser » sur un message
await page.evaluate(() => document.querySelector('#chat .mes:last-child .extraMesButtonsHint')?.click());
const hasBtn = await page.locator('#chat .mes:last-child .pmem-mes-btn').count();
ok(hasBtn === 1, 'Bouton 🧠 présent sur les messages');
await page.evaluate(() => document.querySelector('#chat .mes:last-child .pmem-mes-btn').click());
await page.waitForTimeout(500);
ok(await page.locator('#pmem-dialog').isVisible(), 'Clic 🧠 → éditeur pré-rempli');
const pre = await page.inputValue('#pmem-d-text');
ok(pre.length > 3, `Texte proposé: « ${pre.slice(0, 60)} »`);
await page.fill('#pmem-d-text', 'Seraphina adore se promener sous la pluie');
await page.locator('#pmem-d-save').tap();
await page.waitForTimeout(500);
ok((await memTexts('char:default_Seraphina.png')).some((t) => t.includes('sous la pluie')), 'Mémoriser ce message → souvenir créé');

// bouton flottant + position
await setS({ floating: true, floatX: 50, floatY: 40 });
await P(() => globalThis.permanentMemory.ui.refreshAll());
await page.waitForTimeout(400);
const fl = await P(() => { const r = document.querySelector('#pmem-float').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, parent: document.querySelector('#pmem-float').parentElement.tagName }; });
ok(fl.parent === 'BODY' && fl.w > 30, `Bouton flottant sous <body> (${Math.round(fl.l)},${Math.round(fl.t)}, ${fl.w}px)`);
await setS({ floatX: 90, floatY: 70 });
await P(() => globalThis.permanentMemory.ui.refreshAll());
const fl2 = await P(() => { const r = document.querySelector('#pmem-float').getBoundingClientRect(); return { l: r.left, t: r.top }; });
ok(fl2.l > fl.l && fl2.t > fl.t, 'Sliders X/Y déplacent le bouton');
await shot(page, '12-bouton-flottant');
await page.locator('#pmem-float-btn').tap();
await page.waitForTimeout(400);
ok(await page.locator('#pmem-sheet.pmem-open').isVisible(), 'Tap sur le bouton flottant → panneau');
await P(() => globalThis.permanentMemory.ui.closeSheet());
// pas de transform sur les ancêtres de mes éléments
const bad = await P(() => {
    const out = [];
    for (const sel of ['#pmem-sheet', '#pmem-float', '#pmem-move-done', '#pmem-sheet .pmem-panel']) {
        for (let e = document.querySelector(sel); e && e !== document.documentElement; e = e.parentElement) { const t = getComputedStyle(e).transform; if (t && t !== 'none') out.push(`${sel} ← ${e.tagName}#${e.id}.${e.className}`); }
    }
    return out;
});
ok(bad.length === 0, `Aucun transform sur les ancêtres de l'UI de l'extension (${bad.join('; ')})`);
const formPos = await P(() => getComputedStyle(document.querySelector('#form_sheld')).transform);
ok(formPos === 'none', '#form_sheld sans transform');
// Réglages ST
await setS({ floating: false });
await P(() => globalThis.permanentMemory.ui.refreshAll());
await page.evaluate(() => document.querySelector('#extensionsMenuButton')?.click());
await page.evaluate(() => $('#extensions-settings-button .drawer-toggle').trigger('click'));
await page.waitForTimeout(700);
await page.evaluate(() => { const d = document.querySelector('#pmem_settings .inline-drawer-toggle'); d.click(); d.scrollIntoView(); });
await page.waitForTimeout(500);
await shot(page, '13-reglages');
// mode économie
await page.locator('#pmem_eco').tap();
await page.waitForTimeout(300);
const eco = await P(() => { const s = globalThis.permanentMemory.settings(); return [s.maxTokens, s.maxMemories, s.autoExtract, s.autoSummary]; });
ok(eco[0] === 200 && eco[1] === 4 && eco[2] === false && eco[3] === false, `Mode économie: ${JSON.stringify(eco)}`);
await page.evaluate(() => $('#extensions-settings-button .drawer-toggle').trigger('click'));

// =============================================================== 12. Persistance après rechargement
const idsBefore = await P(() => globalThis.permanentMemory.store.getList('char:default_Seraphina.png').map((m) => m.id).sort());
await sleep(1500);
await page.reload();
await page.waitForFunction(() => globalThis.permanentMemory?.ready, null, { timeout: 40000 });
await page.waitForTimeout(2500);
const idsAfter = await P(() => globalThis.permanentMemory.store.getList('char:default_Seraphina.png', false).map((m) => m.id).sort());
ok(idsAfter.length === idsBefore.length && idsBefore.length > 5 && JSON.stringify(idsAfter) === JSON.stringify(idsBefore), `Après rechargement: ${idsAfter.length} souvenirs retrouvés`);
const eco2 = await P(() => globalThis.permanentMemory.settings().maxTokens);
ok(eco2 === 200, 'Réglages persistants après rechargement (settings.json)');
await connect(page);

// =============================================================== 13. Survit à la suppression d'un chat
await selectChar(page, 'Seraphina');
await slash('/mem add Souvenir qui doit survivre à la suppression du chat, comète rouge');
const cid = await chatId();
await slash('/newchat');
await page.waitForTimeout(2000);
const del = await P(async (a) => { const c = SillyTavern.getContext(); const r = await fetch('/api/chats/delete', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ chatfile: a.cid + '.jsonl', avatar_url: a.av }) }); return r.status; }, { cid, av: ids.sera });
await sleep(1200);
ok((await memTexts('char:default_Seraphina.png')).some((t) => t.includes('comète rouge')), `Souvenir toujours présent après suppression du chat (HTTP ${del})`);

// =============================================================== 14. Sécurité du stockage : lecture échouée → on n'écrase jamais
const safe = await P(async () => {
    const s = globalThis.permanentMemory.store;
    const realFetch = window.fetch; let uploads = 0;
    window.fetch = async (u, o) => { if (String(u).includes('/api/files/upload')) uploads++; if (String(u).includes('permanent_memory_store.json')) return new Response('boom', { status: 500 }); return realFetch(u, o); };
    const saved = Object.keys(s.store.scopes).length;
    const okLoad = await s.loadStore();
    s.markDirty();
    const res = await s.saveStoreNow();
    window.fetch = realFetch;
    await s.loadStore();
    return { okLoad, res, uploads, saved };
});
ok(!safe.okLoad && !safe.res && safe.uploads === 0, 'Lecture du fichier en erreur → aucune écriture (pas d’écrasement)');

ok(errs.length === 0, `Aucune erreur console (${errs.length})`);
if (errs.length) console.log(errs);
await shot(page, '99-final');
await browser.close();
console.log(process.exitCode ? '\n=== ÉCHECS ===' : '\n=== TOUT EST OK ===');
