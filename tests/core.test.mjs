import assert from 'node:assert/strict';
import * as core from '../core.js';
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('OK  ', name); };

t('stem/tokens FR+EN', () => {
    assert.ok(core.tokens("J'aime les pommes").includes(core.stem('pommes')));
    assert.equal(core.stem('pommes'), core.stem('pomme'));
    assert.equal(core.stem('running'), core.stem('run'));
    assert.ok(!core.words('le la les the and').length);
    assert.ok(core.normalize('Éléonore’s').includes('eleonore'));
});
t('jaccard / duplicates', () => {
    const a = core.makeMemory({ text: 'Léa adore les pommes rouges' });
    const b = core.makeMemory({ text: 'Léa adore beaucoup les pommes rouges' });
    const c = core.makeMemory({ text: 'Marc déteste la mer' });
    const d = core.findDuplicates([a, b, c], 0.6);
    assert.equal(d.length, 1);
    assert.ok(core.isNearDuplicate('Léa adore les pommes', [a, c], 0.6));
});
t('selection pertinente + budget + épinglés', () => {
    const mk = (text, o = {}) => ({ m: core.makeMemory({ text, ...o }) });
    const items = [
        mk('Léa déteste les araignées depuis son enfance', { keywords: ['araignée'] }),
        mk('Le royaume de Valmont est en guerre contre le nord'),
        mk('Marc a promis de ramener le dragon à Valmont'),
        mk("La règle d'or : ne jamais mentir à Léa", { pinned: true }),
        mk('Le chat de la voisine s\'appelle Moka'),
    ];
    const r = core.selectMemories(items, ['Il y a une araignée dans la chambre !'], { maxMemories: 3, maxTokens: 400 });
    const txt = r.picked.map((p) => p.m.text);
    assert.ok(txt.some((x) => x.includes('araignées')), 'araignée trouvée (accents/pluriel)');
    assert.ok(txt.some((x) => x.includes('règle d')), 'épinglé toujours');
    assert.ok(!txt.some((x) => x.includes('Moka')), 'hors-sujet absent');
    assert.ok(!txt.some((x) => x.includes('Valmont')), 'hors-sujet absent 2');
    const tiny = core.selectMemories(items, ['Parle-moi de Valmont, du dragon et des araignées'], { maxMemories: 5, maxTokens: 40 });
    assert.ok(tiny.estTokens <= 40 + 2, 'budget respecté ' + tiny.estTokens);
    assert.ok(tiny.skipped.length >= 1);
});
t('heuristique', () => {
    const msgs = [
        { name: 'Léo', is_user: true, idx: 0, mes: "*sourit* Je m'appelle Léo et je t'aime. Il fait beau aujourd'hui." },
        { name: 'Sera', is_user: false, idx: 1, mes: 'Je te promets de revenir le 12 mars. Que veux-tu manger ?' },
        { name: 'Sera', is_user: false, idx: 2, mes: 'Oui, bien sûr, on verra ça plus tard.' },
    ];
    const c = core.heuristicExtract(msgs);
    assert.ok(c.length >= 2, JSON.stringify(c));
    assert.ok(c.some((x) => /t'aime|m'appelle/.test(x.text)));
    assert.ok(c.some((x) => x.type === 'objectif'));
    assert.ok(!c.some((x) => /beau|manger/.test(x.text)));
});
t('parse extraction', () => {
    const r = core.parseExtraction('fait|4|Léo est forgeron à Valmont|Léo,forgeron\n- [relation|5] Léa aime Léo\nRIEN\npréférence|2|Léa adore les pommes|pommes');
    assert.equal(r.length, 3);
    assert.equal(r[0].type, 'fait'); assert.equal(r[0].importance, 4); assert.deepEqual(r[0].keywords, ['Léo', 'forgeron']);
    assert.equal(r[1].type, 'relation'); assert.equal(r[2].type, 'preference');
    assert.deepEqual(core.parseExtraction('RIEN'), []);
});
t('trim message', () => {
    const long = 'Il était une fois un long récit sans importance. '.repeat(10) + 'Je te promets de revenir au château de Valmont demain. ' + 'Encore du blabla. '.repeat(10);
    const r = core.trimMessageForMemory(long, 200);
    assert.ok(r.length <= 260 && /promets/.test(r), r);
});
t('parseExtraction tolérant : JSON, ```, texte autour, réflexion', () => {
    const j = '[{"type":"relation","importance":4,"text":"Léo a promis de protéger Mara","keywords":["Léo","Mara"]},{"type":"lieu","text":"Le phare de Valmont sert de refuge"}]';
    let r = core.parseExtraction(j, 6);
    assert.equal(r.length, 2); assert.equal(r[0].type, 'relation'); assert.equal(r[0].importance, 4); assert.deepEqual(r[0].keywords, ['Léo', 'Mara']);
    r = core.parseExtraction('Voici le résultat :\n```json\n' + j + '\n```\nVoilà !', 6);
    assert.equal(r.length, 2);
    r = core.parseExtraction('{"faits":[{"fait":"Mara déteste le thé froid","importance":2,},]}', 6);
    assert.equal(r.length, 1); assert.equal(r[0].text, 'Mara déteste le thé froid');
    r = core.parseExtraction('<think>je réfléchis | 3 | pas un fait du tout</think>\nVoici les faits :\nfait|3|Léo porte une cape rouge brodée|cape', 6);
    assert.equal(r.length, 1); assert.equal(r[0].text, 'Léo porte une cape rouge brodée');
    r = core.parseExtraction('```\nrelation|5|Léo aime Mara depuis la guerre|amour\n```', 6);
    assert.equal(r.length, 1); assert.equal(r[0].type, 'relation');
    assert.equal(core.parseExtraction('<think>réflexion tronquée sans fin', 6).length, 0);
    assert.equal(core.parseExtraction('RIEN', 6).length, 0);
    assert.equal(core.parseExtraction('["Mara possède une épée runique"]', 6).length, 1);
    assert.equal(core.stripModelNoise('<think>x</think>  ').length, 0);
});
t('1.2.0 prompt d’extraction : faits importants seulement, exemples bon/mauvais, dédoublonnage, format conservé', () => {
    const msgs = [{ name: 'Léo', mes: 'Bonjour Mara.' }, { name: 'Mara', mes: 'Salut.' }];
    const p = core.buildExtractionPrompt(msgs, { maxItems: 8, existing: ['Léo est forgeron à Valmont.', 'Mara se méfie de Théo.'] });
    assert.match(p.systemPrompt, /mémoire à long terme d'un jeu de rôle/);
    assert.match(p.systemPrompt, /type\|importance\(1-5\)\|souvenir\|mot-clé1,mot-clé2/); // format de sortie inchangé
    assert.match(p.systemPrompt, /troisième personne/); assert.match(p.systemPrompt, /10 à 25 mots/);
    assert.match(p.systemPrompt, /AUCUNE phrase ni réplique/); assert.match(p.systemPrompt, /Au maximum 8 lignes/);
    for (const k of ['relations entre personnages', 'jalousie', 'rivalité', 'trahison', 'alliance', 'conflits', 'décisions', 'promesses', 'menaces', 'secrets révélés', 'tournants de l\'intrigue', 'changements de statut', 'faits durables', 'lieux et objets clés']) assert.ok(p.systemPrompt.includes(k), k);
    for (const k of ['gestes', 'regards', 'mouvements', 'ambiance', 'décor', 'répliques ponctuelles', 'émotions passagères', 'réponds RIEN', 'Moins de faits, mais forts']) assert.ok(p.systemPrompt.includes(k), k);
    assert.match(p.systemPrompt, /✗ Marcus fixa longuement la porte par laquelle Livia avait disparu/);
    assert.match(p.systemPrompt, /Marcus veut que Gaius empêche Livia de recommencer/);
    // un contre-exemple recopié par le modèle n'est jamais pris pour un fait
    assert.equal(core.parseExtraction('✗ Marcus fixa la porte.\nrelation|4|Livia a trahi Marcus auprès du préfet Severus.|Livia', 8).length, 1);
    // les exemples du prompt sont eux-mêmes parsables par le parseur existant
    const ex = p.systemPrompt.split('\n').filter((l) => /^(relation|evenement|objectif|preference|lieu)\|/.test(l));
    assert.ok(ex.length >= 4);
    const parsed = core.parseExtraction(ex.join('\n'), 10);
    assert.equal(parsed.length, ex.length);
    for (const e of parsed) { const w = e.text.split(/\s+/).length; assert.ok(w >= 10 && w <= 25, `${w} mots : ${e.text}`); assert.ok(!/["«»]/.test(e.text)); }
    assert.match(p.prompt, /Souvenirs déjà connus[^\n]*\n- Léo est forgeron à Valmont\.\n- Mara se méfie de Théo\./);
    assert.match(p.prompt, /Messages :\nLéo: Bonjour Mara\.\nMara: Salut\./);
    assert.ok(!/Souvenirs déjà connus/.test(core.buildExtractionPrompt(msgs, {}).prompt));
});
t('compactExisting plafonne en caractères', () => {
    const l = core.compactExisting(Array.from({ length: 50 }, (_, i) => `Souvenir numéro ${i} ` + 'mot '.repeat(50)), { maxChars: 800, lineChars: 100 });
    assert.ok(l.length >= 3 && l.length < 10); assert.ok(l.every((x) => x.length <= 101)); assert.ok(l.join('').length <= 800);
});
t('copyReason : guillemets et phrases recopiées', () => {
    const chat = [{ mes: 'Alors voilà, je pense que nous devrions partir demain matin avant le lever du soleil, dit Léo.' }];
    assert.equal(core.copyReason('Léo propose de partir demain à l’aube, avant que le village ne se réveille.', chat), '');
    assert.equal(core.copyReason('Léo dit : « partons »', chat), 'guillemets');
    assert.equal(core.copyReason('Je te promets de revenir bientôt', []), 'première personne');
    assert.equal(core.copyReason('Mara a juré à Léo de revenir bientôt le chercher au village', []), '');
    assert.equal(core.copyReason('Alors voilà je pense que nous devrions partir demain matin avant le lever', chat), 'phrase recopiée');
});
t('analyse locale : faits structurés reformulés, le reste = extrait brut signalé', () => {
    const M = (name, mes, idx = 0) => ({ name, mes, idx, is_user: false });
    const msgs = [M('Léo', "Je m'appelle Léo Durand et j'adore les pommes rouges. J'habite à Valmont avec ma sœur."), M('Mara', "J'aime te voir sourire. Je te promets de revenir le 12 mars. Je suis allergique aux noix, mais tant pis. Je déteste le café froid !"), M('Léo', 'Appelle-moi Rex.')];
    const all = core.heuristicExtract(msgs);
    const texts = all.map((x) => x.text);
    assert.ok(texts.includes('Léo adore les pommes rouges.'));
    assert.ok(texts.includes('Léo habite à Valmont.'));
    assert.ok(texts.includes('Mara est allergique aux noix.'));
    assert.ok(texts.includes('Mara déteste le café froid.'));
    assert.ok(texts.includes('Le nom complet de Léo est Léo Durand.'));
    assert.ok(texts.includes('Léo se présente sous le nom de Rex.'));
    for (const f of all.filter((x) => !x.raw)) assert.ok(!/\b(je|j'|tu|te|t')\b/i.test(f.text), 'pas de 1ʳᵉ personne : ' + f.text);
    const raws = all.filter((x) => x.raw);
    assert.ok(raws.length >= 1 && raws.every((x) => x.raw === 'extrait'));
    assert.ok(raws.some((x) => /promets/.test(x.text)));
    assert.ok(!all.some((x) => /sourire/.test(x.text) && !x.raw), '« j’aime te voir » n’est pas un goût');
    // auto : jamais de phrase brute
    const auto = core.heuristicExtract(msgs, { raw: false });
    assert.ok(auto.length >= 5 && auto.every((x) => !x.raw));
    assert.equal(core.heuristicExtract([M('Mara', 'Je te promets de revenir le 12 mars.')], { raw: false }).length, 0);
});
t('résumé de scène : prompt + nettoyage de la réponse', () => {
    const p = core.buildScenePrompt([{ name: 'Léo', mes: 'Salut' }]);
    assert.match(p.systemPrompt, /résumes la scène récente/); assert.match(p.systemPrompt, /2 à 4 phrases/); assert.match(p.prompt, /Messages :\nLéo: Salut/);
    assert.equal(core.parseSceneSummary('<think>hmm</think>Résumé : « Léo et Mara quittent Valmont. Ils jurent de revenir. »'), 'Léo et Mara quittent Valmont. Ils jurent de revenir.');
    assert.equal(core.parseSceneSummary(''), '');
    assert.equal(core.parseSceneSummary('RIEN.'), '');
    assert.match(p.systemPrompt, /INTERDIT/); assert.match(p.systemPrompt, /réponds RIEN/);
    assert.ok(core.parseSceneSummary('Phrase. '.repeat(200)).length <= 600);
});
t('1.2.0 faits mineurs : gestes / regards écartés, enjeux gardés, importance minimale', () => {
    const bad = ['Marcus fixa la porte par laquelle Livia avait disparu.', 'Octavie sourit doucement en regardant le soleil couchant.', 'Gaius se leva et s\'approcha de la fenêtre.', 'Livia croisa les bras et soupira.'];
    const good = ['Marcus veut que Gaius empêche Livia de recommencer, il le juge devenu trop sûr de lui.', 'Livia a trahi Marcus en livrant ses lettres au préfet.', 'Octavie est jalouse de Livia.', 'Gaius a été nommé centurion de la garde.', 'Severus regarde Livia avec méfiance depuis qu\'elle a menacé sa sœur.'];
    for (const b of bad) assert.ok(core.minorReason(b), 'mineur : ' + b);
    for (const g of good) assert.equal(core.minorReason(g), '', 'important : ' + g);
    const r = core.filterFacts([{ text: good[1], importance: 5 }, { text: bad[0], importance: 4 }, { text: 'Gaius aime le vin de Falerne.', importance: 2 }], { minImportance: 3 });
    assert.equal(r.kept.length, 1); assert.equal(r.minor.length, 2);
    assert.equal(core.filterFacts([{ text: 'Gaius aime le vin de Falerne.', importance: 2 }], { minImportance: 1 }).kept.length, 1);
});
t('1.2.0 mots-clés : pas de mots vides ni d’adverbes, noms propres et substantifs', () => {
    for (const w of ['laquelle', 'longuement', 'lentement', 'soudain', 'pendant', 'chose']) assert.ok(core.STOPWORDS.has(w), w);
    const k = core.autoKeywords('Marcus fixa longuement la porte par laquelle Livia avait disparu.');
    assert.ok(k.includes('Marcus') && k.includes('Livia') && k.includes('porte'), k.join());
    assert.ok(!k.some((x) => /laquelle|longuement|disparu|avait/i.test(x)), k.join());
    const k2 = core.autoKeywords('Marcus veut que Gaius empêche Livia de recommencer, il le juge devenu trop sûr de lui.');
    assert.ok(!k2.some((x) => /recommencer|juge|devenu/i.test(x)), k2.join());
    assert.deepEqual(core.autoKeywords('Le sénateur Brutus garde la dague de son père.'), ['Brutus', 'sénateur', 'dague']);
    const c = core.cleanKeywords(['laquelle', 'longuement', 'Marcus', 'porte', 'Marcus'], 'Marcus et la porte');
    assert.deepEqual(c, ['Marcus', 'porte']);
});
console.log(n, 'tests OK');
