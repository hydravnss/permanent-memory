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
console.log(n, 'tests OK');
