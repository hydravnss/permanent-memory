// Régression 1.0.1 : en GROUPE, les souvenirs épinglés (attribués à plusieurs membres) doivent être injectés.
// Scénario du bug : 3 souvenirs épinglés attribués à 3 membres, un 4e membre (sans souvenir) parle / ou personne n'est encore choisi.
import { boot, connect, say, idle, lastPrompt, mockClear, shot, ok, sleep, ensureChar, ST } from './lib.mjs';

const { browser, page, errs } = await boot();
await connect(page);
const P = (fn, arg) => page.evaluate(fn, arg);
const setS = (patch) => P((p) => { Object.assign(globalThis.permanentMemory.settings(), p); }, patch);
const block = async () => { const p = await lastPrompt(); const m = p.match(/\[Mémoire de [^\n]*\n[\s\S]*?\n\]/); return m ? m[0] : ''; };

const names = ['Joseph', 'Reinhard', 'Adolf', 'Heinrich'];
const av = {};
for (const n of names) av[n] = await ensureChar(page, n);
const gid = await P(async (a) => {
    const c = SillyTavern.getContext();
    let g = c.groups.find((x) => x.name === 'Groupe REG');
    if (!g) {
        const r = await fetch('/api/groups/create', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ name: 'Groupe REG', members: a, avatar_url: '', chat_id: 'reg-group-chat-1', chats: ['reg-group-chat-1'] }) });
        if (!r.ok) throw new Error('create group ' + r.status);
        const gm = await import('/scripts/group-chats.js');
        await gm.getGroups();
        g = SillyTavern.getContext().groups.find((x) => x.name === 'Groupe REG');
    }
    return g.id;
}, names.map((n) => av[n]));

// départ propre + réglages PAR DÉFAUT (on ne touche pas à groupAllMembers)
await P(async () => { const s = globalThis.permanentMemory.store; s.store.scopes = {}; s.store.candidates = []; s.store.rejected = []; await s.saveStoreNow(); });
await P(() => { const es = SillyTavern.getContext().extensionSettings; delete es.permanent_memory; globalThis.permanentMemory.settings(); });
await setS({ enabled: true, neverAI: true, heuristics: false, maxTokens: 400, maxMemories: 6, position: 1, depth: 4, role: 0 });
await mockClear();
await P(async (g) => { const gm = await import('/scripts/group-chats.js'); await gm.openGroupById(g); }, gid);
await page.waitForTimeout(2500);

const def = await P(() => { const s = globalThis.permanentMemory.settings(); return { all: s.groupAllMembers, muted: s.groupIncludeMuted }; });
ok(def.all === true && def.muted === true, 'Réglage par défaut : groupAllMembers = ON (tous les membres), groupIncludeMuted = ON');

// 3 souvenirs ÉPINGLÉS attribués à 3 membres différents (comme chez l'utilisateur)
const add = (who, text) => P(({ key, text }) => globalThis.permanentMemory.store.addMemory(key, { text, type: 'relation', importance: 5, pinned: true }).entry.id, { key: `char:${av[who]}`, text });
await add('Joseph', 'Joseph est en couple avec Adolf, ils sont inséparables');
await add('Reinhard', 'Reinhard est amoureux d’Heinrich en secret');
await add('Adolf', 'Adolf vit avec Joseph dans la villa du lac');
await sleep(1200);

const gen = (n) => P(async (name) => { const c = SillyTavern.getContext(); const i = c.characters.findIndex((x) => x.name === name); await c.generate('normal', { force_chid: i }); }, n);
const send = (t) => P(async (t) => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/send ' + t); }, t);
const check = (b, label) => ok(b.includes('Joseph est en couple') && b.includes('Reinhard est amoureux') && b.includes('Adolf vit avec Joseph'), label);

// --- 1. Aperçu (aucun orateur choisi) : les 3 sont injectés
const pv = await P(async () => { const r = await globalThis.permanentMemory.engine.buildInjection({ type: 'normal', speaker: null }); return { n: r.picked.length, cand: r.candidates, tokens: r.tokens, budget: r.budget }; });
ok(pv.n === 3 && pv.cand === 3 && pv.tokens <= pv.budget, `Aperçu groupe : 3 souvenirs épinglés injectés (${pv.n}/${pv.cand}, ${pv.tokens}/${pv.budget} tokens)`);

// --- 2. Vraie génération : un 4e membre SANS souvenir parle → les 3 souvenirs épinglés sont quand même injectés
await P(() => { const s = globalThis.permanentMemory.store; for (const { m } of s.allEntries()) m.uses = 0; });
await mockClear();
await send('Raconte-nous la soirée.');
await gen('Heinrich');
await idle(page);
let b = await block();
console.log('--- Heinrich parle ---\n' + b);
check(b, 'Groupe, le 4e membre (sans souvenir) parle : les 3 souvenirs épinglés sont injectés');
ok((b.match(/^- /gm) || []).length === 3, 'Exactement 3 lignes injectées');
const uses = await P(() => globalThis.permanentMemory.store.allEntries().map((x) => x.m.uses));
ok(uses.every((u) => u === 1), `Compteur « utilisé » = 1 pour chacun après UNE vraie génération (${uses}) — pas de double comptage du passage « niveau groupe »`);
const li = await P(() => { const l = globalThis.permanentMemory.engine.state.lastInjection; return { n: l.picked.length, sp: l.speakerName, tokens: l.tokens, scopes: l.picked.map((p) => p.scopeLabel) }; });
ok(li.n === 3 && li.sp === 'Heinrich' && li.tokens > 0, `Dernière injection : 3 souvenirs, orateur ${li.sp}, ${li.tokens} tokens, portées ${li.scopes.join(' | ')}`);

// --- 3. Chacun des 4 orateurs possibles
for (const n of names) {
    await mockClear();
    await gen(n);
    await idle(page);
    check(await block(), `Orateur ${n} : les 3 souvenirs épinglés injectés`);
}

// --- 4. Membre « muet » : toujours injecté (réglage ON par défaut)
await P((g) => { const gr = SillyTavern.getContext().groups.find((x) => x.id === g); gr.disabled_members = [SillyTavern.getContext().characters.find((x) => x.name === 'Joseph').avatar]; }, gid);
const pm1 = await P(async () => (await globalThis.permanentMemory.engine.buildInjection({ speaker: null })).picked.length);
ok(pm1 === 3, 'Membre muet (Joseph) : son souvenir est quand même injecté (par défaut)');
await setS({ groupIncludeMuted: false });
const pm2 = await P(async () => (await globalThis.permanentMemory.engine.buildInjection({ speaker: null })).picked.length);
ok(pm2 === 2, 'Réglage « inclure les muets » décoché : 2 souvenirs');
await setS({ groupIncludeMuted: true });
await P((g) => { SillyTavern.getContext().groups.find((x) => x.id === g).disabled_members = []; }, gid);

// --- 5. « Peek » d'un membre (ST fixe characterId sur la fiche ouverte) : ne doit rien changer
const peek = await P(async () => {
    const c = SillyTavern.getContext();
    const i = c.characters.findIndex((x) => x.name === 'Heinrich');
    const sc = await import('/script.js');
    sc.setCharacterId(i);
    const r = await globalThis.permanentMemory.engine.buildInjection({ type: 'normal' });
    sc.setCharacterId(undefined);
    return r.picked.length;
});
ok(peek === 3, 'Fiche d’un membre sans souvenir ouverte (characterId défini) : les 3 souvenirs restent injectés');

// --- 6. Mode isolé (optionnel) : reproduit l'ancien bug, mais le diagnostic l'explique
await setS({ groupAllMembers: false });
await mockClear();
await gen('Heinrich');
await idle(page);
b = await block();
ok(b === '', 'Réglage isolé + 4e membre qui parle : rien injecté (comportement de la 1.0.0, désormais OPTIONNEL)');
const rep = await P(async () => { const r = await globalThis.permanentMemory.engine.buildInjection({ speaker: globalThis.SillyTavern.getContext().characters.find((x) => x.name === 'Heinrich').avatar }); return { cand: r.candidates, ign: r.report.ignored.length, why: r.why }; });
console.log(rep.why.join('\n'));
ok(rep.cand === 0 && rep.ign === 3 && rep.why.some((w) => /NON injecté/.test(w)), 'Le diagnostic explique pourquoi (3 portées de membres listées comme non injectées)');
await setS({ groupAllMembers: true });

// --- 7. Budget respecté, épinglés d'abord
await setS({ maxTokens: 60 });
const small = await P(async () => { const r = await globalThis.permanentMemory.engine.buildInjection({ speaker: null }); return { tokens: r.tokens, n: r.picked.length, w: r.warnings }; });
ok(small.tokens <= 60 && small.n >= 1 && small.n < 3, `Budget 60 tokens respecté : ${small.n} souvenir(s), ${small.tokens} tokens, avertissement : ${small.w[0] || '—'}`);
await setS({ maxTokens: 400 });

// --- 8. Non épinglés : pertinents de tous les membres, le souvenir de l'orateur favorisé
await P(() => { const s = globalThis.permanentMemory.store; for (const { m } of s.allEntries()) m.pinned = false; });
await P(({ a, b }) => {
    const s = globalThis.permanentMemory.store;
    s.addMemory(`char:${a}`, { text: 'Joseph collectionne des timbres rares du lac', importance: 3 });
    s.addMemory(`char:${b}`, { text: 'Heinrich collectionne des timbres anciens du lac', importance: 3 });
}, { a: av.Joseph, b: av.Heinrich });
await mockClear();
await send('Qui collectionne des timbres du lac ?');
await gen('Heinrich');
await idle(page);
b = await block();
ok(b.includes('Joseph collectionne') && b.includes('Heinrich collectionne'), 'Non épinglés pertinents : souvenirs de plusieurs membres injectés');
ok(b.indexOf('Heinrich collectionne') < b.indexOf('Joseph collectionne'), 'Le souvenir de l’orateur (Heinrich) passe en premier (boost)');

// --- 9. Test d'injection (diagnostic) par orateur
await P(() => { const s = globalThis.permanentMemory.store; for (const { m } of s.allEntries()) m.pinned = true; });
const tests = await P(() => globalThis.permanentMemory.engine.testInjection());
ok(tests.length === 5 && tests.every((t) => t.count >= 3), `testInjection : ${tests.length} cas (orateur inconnu + 4 membres), chacun ≥ 3 souvenirs`);

// --- 10. UI : onglet Injection, cartes, éditeur, bouton de test (captures iPhone)
await P(() => globalThis.permanentMemory.ui.openSheet('mem'));
await page.waitForTimeout(600);
await page.screenshot({ path: '/workspace/st-test-shots/mem2-01-souvenirs-groupe.png' });
const cards = await P(() => [...document.querySelectorAll('#pmem-body .pmem-card')].map((c) => c.querySelector('.pmem-scope')?.textContent));
ok(cards.length >= 5 && cards.every(Boolean), `Chaque carte montre son attribution : ${cards.slice(0, 5).join(' | ')}`);
ok(await P(() => !!document.querySelector('#pmem-body .pmem-reassign')), 'Sélecteur « Attribuer à » présent sur les cartes');
// réattribution rapide vers le groupe
const moved = await P(({ gid }) => {
    const sel = document.querySelector('#pmem-body .pmem-reassign');
    const id = sel.dataset.id; sel.value = `group:${gid}`; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return globalThis.permanentMemory.store.getList(`group:${gid}`, false).some((m) => m.id === id);
}, { gid });
ok(moved, 'Réattribution rapide d’un souvenir « à tout le groupe » depuis la carte');
await P(() => globalThis.permanentMemory.ui.openSheet('inj'));
await page.waitForTimeout(900);
await page.click('#pmem-testinj');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/workspace/st-test-shots/mem2-02-injection-test.png' });
const testTxt = await P(() => document.querySelector('#pmem-testbox')?.innerText || '');
ok(/Heinrich/.test(testTxt) && /Avant le choix/.test(testTxt), 'Bouton « Tester l’injection maintenant » : liste par orateur possible');
// éditeur
await P(() => globalThis.permanentMemory.ui.openSheet('mem'));
await page.waitForTimeout(400);
await page.click('#pmem-body [data-act="new"]');
await page.waitForTimeout(500);
const defScope = await P(() => document.querySelector('#pmem-d-scope')?.value);
ok(defScope === `group:${gid}`, `Nouveau souvenir en groupe : « Attribuer à » = tout le groupe par défaut (${defScope})`);
await page.screenshot({ path: '/workspace/st-test-shots/mem2-03-editeur-attribuer.png' });
await P(() => document.querySelector('#pmem-d-cancel').click());

// --- 11. Diagnostic « rien injecté » avec stockage vide d'actifs (capture)
await P(() => { const s = globalThis.permanentMemory.store; for (const { m } of s.allEntries()) m.enabled = false; });
await P(() => globalThis.permanentMemory.ui.openSheet('inj'));
await page.waitForTimeout(1000);
await page.screenshot({ path: '/workspace/st-test-shots/mem2-04-injection-pourquoi-0.png' });
const whyTxt = await P(() => document.querySelector('#pmem-injbox')?.innerText || '');
ok(/désactivé/.test(whyTxt) && /Portées lues/.test(whyTxt), 'Injection à 0 : l’onglet explique les filtres (désactivés) et les portées lues');
await P(() => { const s = globalThis.permanentMemory.store; for (const { m } of s.allEntries()) m.enabled = true; });

console.log(errs.length ? 'Erreurs console:\n' + errs.join('\n') : 'Aucune erreur console');
ok(errs.length === 0, 'Aucune erreur JS');
await browser.close();
