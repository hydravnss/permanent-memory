/**
 * Mémoire Permanente — cœur « pur » (sans DOM, sans SillyTavern).
 * Tout ce qui est ici est local, gratuit (zéro appel API) et testable sous Node.
 *
 *  - normalisation / tokenisation FR+EN (stopwords, racinisation légère)
 *  - classement BM25 + mots-clés + importance + récence (+ épinglés toujours)
 *  - sélection sous budget (nb max de souvenirs ET tokens)
 *  - détection de doublons (Jaccard) et fusion
 *  - extraction heuristique locale (regex) de souvenirs « candidats »
 *  - analyse de la réponse de l'IA pour l'extraction groupée
 */

export const TYPES = Object.freeze({
    fait: 'Fait',
    relation: 'Relation',
    evenement: 'Événement',
    preference: 'Préférence',
    lieu: 'Lieu',
    objectif: 'Promesse / objectif',
    resume: 'Résumé',
});
export const TYPE_ICONS = Object.freeze({ fait: '📌', relation: '❤️', evenement: '⚡', preference: '⭐', lieu: '📍', objectif: '🎯', resume: '📝' });

/* ------------------------------------------------------------------ texte */

const STOP_FR = `a ai aie aient aies ait as au aux avec avoir avons avez ayant c ca car ce ceci cela celle celles celui ces cet cette ceux chaque ci comme comment d dans de des donc dont du elle elles en encore es est et etaient etais etait ete etre eu eux fait faire fais font il ils j je jusque l la le les leur leurs lui m ma mais me meme mes moi mon n ne ni nos notre nous on ont ou ou par pas pour pourquoi qu que quel quelle quelles quels qui s sa sans se ses si sien son sont sous sur t ta te tes toi ton tous tout toute toutes tres tu un une vos votre vous y suis es sommes etes sera serai seras serons seront serait aurait aura auras auront avait avais avaient ici la alors aussi bien peu plus moins puis ensuite voila voici quand lorsque tandis entre vers chez deja jamais toujours rien quelque quelques autre autres ainsi cependant pourtant peut peux veux veut vais va vas vont allez allons ete oui non ah oh eh hm hum euh ben bah hein ok`;
const STOP_EN = `a about after all also am an and any are as at be because been before being but by can could did do does doing for from had has have having he her here hers him his how i if in into is it its just me more most my no nor not of on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself im ive ill id dont didnt cant wont isnt arent wasnt`;
export const STOPWORDS = new Set((STOP_FR + ' ' + STOP_EN).split(/\s+/).filter(Boolean));

/** minuscules, sans accents, apostrophes unifiées */
export function normalize(s) {
    return String(s ?? '')
        .toLowerCase()
        .replace(/[’‘`´]/g, "'")
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/œ/g, 'oe')
        .replace(/æ/g, 'ae');
}

const SUFFIXES = ['issements', 'issement', 'atrices', 'atrice', 'ateurs', 'ateur', 'ations', 'ation', 'ements', 'ement', 'ements', 'euses', 'euse', 'ables', 'able', 'ibles', 'ible', 'ments', 'ment', 'ences', 'ence', 'ances', 'ance', 'ities', 'ity', 'ness', 'ings', 'ing', 'aient', 'erons', 'eront', 'erait', 'erais', 'erai', 'eras', 'era', 'erez', 'erions', 'ions', 'ais', 'ait', 'ant', 'ees', 'ee', 'ez', 'ent', 'es', 'er', 'ed', 'ly', 'e', 's', 'x'];

/** racinisation « légère » FR/EN : retire une terminaison courante, garde au moins 3 lettres */
export function stem(w) {
    if (w.length <= 3 || /^\d+$/.test(w)) return w;
    for (const suf of SUFFIXES) {
        if (w.length - suf.length >= 3 && w.endsWith(suf)) {
            w = w.slice(0, -suf.length);
            break;
        }
    }
    // consonne doublée finale (mangeait→mang ; running→runn→run)
    if (w.length > 3 && w[w.length - 1] === w[w.length - 2] && !/[aeiou]/.test(w[w.length - 1])) w = w.slice(0, -1);
    return w;
}

/** Tokens bruts normalisés (sans stopwords), non racinisés. */
export function words(text) {
    const n = normalize(text).replace(/'/g, ' ');
    return (n.match(/[a-z0-9]+/g) || []).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Tokens racinisés (tableau, doublons conservés). */
export function tokens(text) {
    return words(text).map(stem);
}

export function tokenSet(text) {
    return new Set(tokens(text));
}

export function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
}

/** Estimation rapide (sans API) : ~3,6 caractères par token en français. */
export function estTokens(text) {
    return Math.ceil(String(text ?? '').length / 3.6);
}

export function cleanText(s) {
    return String(s ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[*_~`#>]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function shortId(taken = new Set()) {
    for (let i = 0; i < 50; i++) {
        const id = Math.random().toString(36).slice(2, 7);
        if (!taken.has(id) && /[a-z]/.test(id[0])) return id;
    }
    return 'm' + Date.now().toString(36);
}

export function normType(t) {
    const n = normalize(t).replace(/[^a-z]/g, '');
    if (TYPES[n]) return n;
    const map = { evenement: 'evenement', event: 'evenement', events: 'evenement', pref: 'preference', preferences: 'preference', promesse: 'objectif', objectifs: 'objectif', promesseobjectif: 'objectif', goal: 'objectif', promise: 'objectif', place: 'lieu', lieux: 'lieu', fact: 'fait', faits: 'fait', rel: 'relation', relations: 'relation', summary: 'resume' };
    return map[n] || 'fait';
}

export function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/** Construit une entrée de mémoire complète à partir de champs partiels. */
export function makeMemory(fields = {}, takenIds = new Set()) {
    const text = cleanText(fields.text).slice(0, 600);
    const kws = Array.isArray(fields.keywords) ? fields.keywords : String(fields.keywords ?? '').split(/[,;\n]/);
    return {
        id: fields.id || shortId(takenIds),
        text,
        type: normType(fields.type || 'fait'),
        importance: clampInt(fields.importance, 1, 5, 3),
        keywords: [...new Set(kws.map((k) => String(k).trim()).filter(Boolean))].slice(0, 12),
        created: Number(fields.created) || Date.now(),
        lastUsed: fields.lastUsed ? Number(fields.lastUsed) : null,
        uses: Number(fields.uses) || 0,
        pinned: !!fields.pinned,
        enabled: fields.enabled !== false,
        archived: !!fields.archived,
        src: fields.src && typeof fields.src === 'object' ? { idx: fields.src.idx ?? null, chat: fields.src.chat ?? null } : { idx: null, chat: null },
        ...(fields.summary ? { summary: true } : {}),
    };
}

/* ------------------------------------------------------------------ classement */

export const DEFAULT_RANK = Object.freeze({
    minScore: 0.5, // sensibilité : score de pertinence minimal pour un souvenir non épinglé
    scanDepth: 4, // nb de messages récents analysés
    maxMemories: 6,
    maxTokens: 400,
    headerTokens: 12,
    recencyWeight: 0.4,
    importanceWeight: 0.35,
});

/**
 * @param {Array<{m:object, owner?:string, boost?:number}>} items  souvenirs candidats
 * @param {string[]} recentTexts  textes des messages récents, du plus ancien au plus récent
 */
export function rankMemories(items, recentTexts, opts = {}, now = Date.now()) {
    const o = { ...DEFAULT_RANK, ...opts };
    const msgs = recentTexts.slice(-Math.max(1, o.scanDepth));
    // noms du perso / de l'utilisateur : présents partout, ils ne disent rien sur le sujet
    const ignore = new Set((o.ignoreNames || []).flatMap((n) => tokens(n)));
    // poids de la requête par token (le dernier message pèse le plus)
    const q = new Map();
    const decay = [1, 0.7, 0.5, 0.35, 0.25, 0.2];
    msgs.slice().reverse().forEach((t, i) => {
        const w = decay[Math.min(i, decay.length - 1)];
        for (const tok of new Set(tokens(t))) if (!ignore.has(tok)) q.set(tok, Math.max(q.get(tok) || 0, w));
    });
    const normQuery = msgs.map((t) => normalize(t)).join(' \n ');

    // corpus
    const docs = items.map((it) => {
        const tf = new Map();
        for (const tok of tokens(it.m.text)) tf.set(tok, (tf.get(tok) || 0) + 1);
        for (const k of it.m.keywords || []) for (const tok of tokens(k)) tf.set(tok, (tf.get(tok) || 0) + 2);
        let len = 0;
        for (const v of tf.values()) len += v;
        return { tf, len: Math.max(1, len) };
    });
    const N = Math.max(1, docs.length);
    const avg = docs.reduce((a, d) => a + d.len, 0) / N || 1;
    const df = new Map();
    for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);

    const k1 = 1.2;
    const b = 0.75;
    return items.map((it, i) => {
        const d = docs[i];
        let bm = 0;
        const hits = [];
        for (const [tok, qw] of q) {
            const f = d.tf.get(tok);
            if (!f) continue;
            const idf = Math.log(1 + (N + 1) / (df.get(tok) + 0.5));
            bm += qw * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
            hits.push(tok);
        }
        // mot-clé explicite (expression normalisée présente telle quelle dans les messages récents)
        let kw = 0;
        const kwHits = [];
        for (const k of it.m.keywords || []) {
            const nk = normalize(k).trim();
            if (nk.length < 2) continue;
            const re = new RegExp(`(^|[^a-z0-9])${nk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
            if (re.test(normQuery)) { kw += 1.5; kwHits.push(k); }
        }
        kw = Math.min(kw, 3);
        const rel = (bm + kw) * (it.boost || 1);
        const ageDays = Math.max(0, (now - (it.m.created || now)) / 86400000);
        const recency = o.recencyWeight * Math.exp(-ageDays / 30);
        const imp = (clampInt(it.m.importance, 1, 5, 3) - 3) * o.importanceWeight;
        return { ...it, rel, score: rel + imp + recency, hits, kwHits, relevant: rel >= o.minScore };
    });
}

/** Ligne injectée pour un souvenir. */
export function formatLine(it) {
    const prefix = it.owner ? `(${it.owner}) ` : '';
    return `- ${prefix}${it.m.text}`;
}

/**
 * Sélection locale (zéro API) sous budget.
 * Épinglés : toujours candidats (hors limite de nombre) mais dans le budget de tokens.
 * Retourne { picked, skipped, pinnedDropped, header, text, estTokens }
 */
export function selectMemories(items, recentTexts, opts = {}, now = Date.now()) {
    const o = { ...DEFAULT_RANK, ...opts };
    const ranked = rankMemories(items, recentTexts, o, now);
    const pinned = ranked.filter((r) => r.m.pinned).sort((a, b) => b.m.importance - a.m.importance || a.m.created - b.m.created);
    const rest = ranked.filter((r) => !r.m.pinned && r.relevant).sort((a, b) => b.score - a.score);
    const picked = [];
    const skipped = [];
    let pinnedDropped = 0;
    let budget = o.maxTokens - o.headerTokens;
    let used = 0;
    const tryAdd = (r, isPinned) => {
        let line = formatLine(r);
        let t = estTokens(line) + 1;
        if (t > budget - used) {
            if (isPinned && used === 0 && budget > 20) {
                // une seule entrée trop longue : on la tronque plutôt que de tout perdre
                const maxChars = Math.floor((budget - used - 1) * 3.6);
                line = line.slice(0, Math.max(10, maxChars - 1)).trimEnd() + '…';
                t = estTokens(line) + 1;
                picked.push({ ...r, line, tokens: t, truncated: true, pinned: true });
                used += t;
                return true;
            }
            return false;
        }
        picked.push({ ...r, line, tokens: t, pinned: isPinned });
        used += t;
        return true;
    };
    for (const r of pinned) if (!tryAdd(r, true)) pinnedDropped++;
    for (const r of rest) {
        if (picked.filter((p) => !p.pinned).length >= o.maxMemories) { skipped.push({ ...r, why: 'max' }); continue; }
        if (!tryAdd(r, false)) skipped.push({ ...r, why: 'budget' });
    }
    return { picked, skipped, pinnedDropped, estTokens: used + o.headerTokens, ranked };
}

/* ------------------------------------------------------------------ doublons */

export function findDuplicates(memories, threshold = 0.6) {
    const sets = memories.map((m) => tokenSet(m.text));
    const pairs = [];
    for (let i = 0; i < memories.length; i++) {
        for (let j = i + 1; j < memories.length; j++) {
            const s = jaccard(sets[i], sets[j]);
            if (s >= threshold) pairs.push({ a: memories[i], b: memories[j], score: Math.round(s * 100) / 100 });
        }
    }
    return pairs.sort((x, y) => y.score - x.score);
}

export function isNearDuplicate(text, memories, threshold = 0.7) {
    const s = tokenSet(text);
    if (!s.size) return null;
    for (const m of memories) if (jaccard(s, tokenSet(m.text)) >= threshold) return m;
    return null;
}

/** Fusionne b dans a (a est conservé) : plus grande importance, épinglé si l'un l'est, mots-clés réunis, texte le plus long. */
export function mergeInto(a, b) {
    a.text = (b.text || '').length > (a.text || '').length ? b.text : a.text;
    a.importance = Math.max(a.importance, b.importance);
    a.pinned = a.pinned || b.pinned;
    a.keywords = [...new Set([...(a.keywords || []), ...(b.keywords || [])])].slice(0, 12);
    a.created = Math.min(a.created, b.created);
    a.lastUsed = Math.max(a.lastUsed || 0, b.lastUsed || 0) || null;
    a.uses = (a.uses || 0) + (b.uses || 0);
    a.enabled = a.enabled || b.enabled;
    return a;
}

/* ------------------------------------------------------------------ extraction heuristique locale */

const MONTHS = 'janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december';
const PATTERNS = [
    { re: /\b(je (te |vous )?(promets|jure)|promis|promesse|je te le promets|i promise|i swear|je m'engage|on se retrouve|je reviendrai|je ferai tout pour)\b/, type: 'objectif', imp: 4, w: 3 },
    { re: /\b(souviens[- ]?toi|rappelle[- ]?toi|n'oublie (pas|jamais)|ne l'oublie pas|ne l'oublie jamais|remember (that|this|when)|don't forget|garde (bien )?en tete)\b/, type: 'fait', imp: 4, w: 3 },
    { re: /\b(je t'aime|je t'adore|je suis amoureu(x|se)|i love you|je tiens a toi|tu comptes (beaucoup )?pour moi)\b/, type: 'relation', imp: 5, w: 3 },
    { re: /\b(je m'appelle|mon (nom|prenom) (est|c'est)|appelle[- ]moi|on m'appelle|my name is|call me|i'm called|je suis (le|la) fils|je suis (le|la) fille)\b/, type: 'fait', imp: 4, w: 3 },
    { re: /\b(secret|personne ne (doit |sait)|ne le dis a personne|entre nous)\b/, type: 'fait', imp: 4, w: 2 },
    { re: /\b(mariage|se marier|epous\w*|fiance\w*|bague|naissance|enceinte|bebe|deces|meurt|mort|morte|tue[es]?|assassin\w*|trahi\w*|trahison|kidnapp\w*|enleve\w*|blesse\w*|sauve[es]?|cadeau|anniversaire|premier baiser|baiser|embrasse\w*|rupture|quitte[es]?|disparu\w*|decouvert|decouvre)\b/, type: 'evenement', imp: 3, w: 2 },
    { re: /\b(j'aime|j'adore|je deteste|je hais|mon (prefere|favori)|ma (preferee|favorite)|je prefere|je suis allergique|i (really )?(like|love|hate|prefer)|my favou?rite|je ne supporte pas)\b/, type: 'preference', imp: 3, w: 2 },
    { re: /\b(j'habite|je vis (a|au|en|dans)|nous (sommes|habitons|vivons) (a|au|en|dans)|on habite|on vit|mon (appartement|manoir|chateau|royaume|village|ecole|foyer)|i live in|home is)\b/, type: 'lieu', imp: 3, w: 2 },
    { re: /\b(mon|ma|mes|ton|ta|tes|son|sa) (frere|soeur|pere|mere|fils|fille|mari|femme|epoux|epouse|ami|amie|ennemi|rival|rivale|maitre|maitresse|patron|oncle|tante|cousin|cousine|grand-mere|grand-pere)\b|\bmy (brother|sister|father|mother|son|daughter|husband|wife|friend|enemy|boss|master)\b/, type: 'relation', imp: 3, w: 2 },
    { re: /\b(il faut que je|je dois|je vais (te|vous|le|la|les|enfin)|ma mission|mon but|mon reve|je veux devenir|je compte)\b/, type: 'objectif', imp: 3, w: 1 },
];
const DATE_RE = new RegExp(`\\b(\\d{1,2}(er)? (${MONTHS})|(19|20)\\d\\d|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|hier|ce soir|la semaine (prochaine|derniere)|l'an prochain|il y a \\d+ (jours?|ans?|mois))\\b`);

function sentencesOf(text) {
    return cleanText(text.replace(/\n+/g, '. ')).split(/(?<=[.!?…»"])\s+(?=[A-ZÀ-ÖØ-ÞÉÈÊ«"'“\d])/u).map((s) => s.trim()).filter(Boolean);
}

function capNames(sentence) {
    const out = [];
    const ws = sentence.split(/\s+/);
    ws.forEach((w, i) => {
        const clean = w.replace(/^[«"'“(]+|[.,;:!?…»"'”)]+$/g, '');
        if (i === 0 || clean.length < 3) return;
        if (/^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{2,}$/u.test(clean) && !STOPWORDS.has(normalize(clean))) out.push(clean);
    });
    return [...new Set(out)];
}

/** Mots-clés automatiques : noms propres + 1–2 mots longs. */
export function autoKeywords(text, max = 4) {
    const names = capNames(' ' + cleanText(text));
    const longs = [...new Set(words(text).filter((w) => w.length >= 6))].sort((a, b) => b.length - a.length).slice(0, 2);
    return [...new Set([...names, ...longs])].slice(0, max);
}

/** Score d'une phrase : { score, type, imp } — score >= 2 = candidat. */
export function scoreSentence(sentence) {
    const n = normalize(sentence);
    let score = 0;
    let type = null;
    let imp = 2;
    let best = 0;
    for (const p of PATTERNS) {
        if (p.re.test(n)) {
            score += p.w;
            if (p.w > best) { best = p.w; type = p.type; }
            imp = Math.max(imp, p.imp);
        }
    }
    if (DATE_RE.test(n)) score += 1;
    if (capNames(sentence).length) score += 1;
    if (/\?\s*$/.test(sentence.trim()) && best < 3) score -= 2;
    if (!type) type = DATE_RE.test(n) ? 'evenement' : 'fait';
    return { score, type, imp };
}

/* -- faits structurés : seuls cas où l'analyse locale peut reformuler sans se tromper (phrase à la 1ʳᵉ personne, forme très fixe) -- */

const CAP = /^\p{Lu}/u;
const STOP_AT = /\s+(?:et|mais|car|donc|puis|avec|depuis|parce|pour|quand|que|qui|où|ou)\s.*$/i;
const clean1 = (s) => s.replace(STOP_AT, '').replace(/[\s"»”)]+$/g, '').trim();
const nWords = (s) => s.split(/\s+/).filter(Boolean).length;
const BAD_OBJ = /\b(que|qu'|quand|ce|ça|cela|tu|te|t'|toi|vous|je|j'|me|m'|moi|nous|il|elle|ils|elles|lui|être|faire|voir|avoir)\b/i;

/**
 * Faits très simples et fiables, reformulés à la 3ᵉ personne (« Léo s'appelle… », « Mara habite… », goûts, allergie).
 * Tout le reste n'est PAS résumable en local : voir heuristicExtract(…, { raw: true }).
 */
export function structuredFacts(sentence, speaker) {
    const name = String(speaker || '').trim();
    if (!name) return [];
    const s = String(sentence).replace(/[’‘`´]/g, "'").replace(/[«»“”"]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return [];
    const isQuestion = /\?\s*$/.test(s) && !/(?:appelle[- ]moi|call me)/i.test(s);
    if (isQuestion) return [];
    const out = [];
    let m;
    if ((m = s.match(/\b(?:je m'appelle|mon (?:nom|prénom|prenom) (?:est|c'est)|on m'appelle|appelle-moi|appelle moi|my name is|call me)\s+(\p{L}[\p{L}'-]*(?:\s+\p{L}[\p{L}'-]*)?)/iu))) {
        const caps = [];
        for (const w of m[1].split(/\s+/)) { if (CAP.test(w) && w.length >= 2) caps.push(w); else break; }
        const nm = caps.join(' ');
        if (nm && normalize(nm) !== normalize(name) && !STOPWORDS.has(normalize(nm))) {
            const full = normalize(nm).startsWith(`${normalize(name)} `);
            out.push({ text: full ? `Le nom complet de ${name} est ${nm}.` : `${name} se présente sous le nom de ${nm}.`, type: 'fait', importance: 4 });
        }
    }
    if ((m = s.match(/\bj'habite\s+(à|au|aux|en|dans|près de|sur|chez)\s+([^.,;!?…]{2,40})/i))) {
        const obj = clean1(m[2]);
        if (obj && nWords(obj) <= 5 && !BAD_OBJ.test(obj)) out.push({ text: `${name} habite ${m[1].toLowerCase()} ${obj}.`, type: 'lieu', importance: 3 });
    }
    if ((m = s.match(/\bje suis allergique\s+(à|aux|au)\s+([^.,;!?…]{2,30})/i))) {
        const obj = clean1(m[2]);
        if (obj && nWords(obj) <= 4 && !BAD_OBJ.test(obj)) out.push({ text: `${name} est allergique ${m[1].toLowerCase()} ${obj}.`, type: 'fait', importance: 4 });
    }
    const like = (re, verb, imp) => {
        const mm = s.match(re);
        if (!mm) return;
        const obj = clean1(mm[1]);
        if (obj && nWords(obj) <= 5 && !BAD_OBJ.test(obj)) out.push({ text: `${name} ${verb} ${obj}.`, type: 'preference', importance: imp });
    };
    const ART = "(?:le|la|les|l'|un|une|des|du|de la|d'|mon|ma|mes|ton|ta|tes|notre|nos)";
    like(new RegExp(`\\bj'adore\\s+(${ART}\\s?[^.,;!?…]{2,30})`, 'i'), 'adore', 3);
    like(new RegExp(`\\bj'aime(?: bien| beaucoup)?\\s+(${ART}\\s?[^.,;!?…]{2,30})`, 'i'), 'aime', 3);
    like(new RegExp(`\\bje préfère\\s+(${ART}\\s?[^.,;!?…]{2,30})`, 'i'), 'préfère', 3);
    like(new RegExp(`\\bje (?:déteste|hais)\\s+(${ART}\\s?[^.,;!?…]{2,30})`, 'i'), 'déteste', 3);
    like(new RegExp(`\\bje ne supporte pas\\s+(${ART}\\s?[^.,;!?…]{2,30})`, 'i'), 'ne supporte pas', 3);
    return out;
}

/**
 * Analyse locale (gratuite). Elle NE SAIT PAS résumer :
 *  - faits structurés fiables, reformulés (raw: '')  → utilisables tels quels ;
 *  - avec `raw: true` (par défaut) : en plus, la phrase brute la plus marquante, signalée raw: 'extrait' = « extrait brut, à reformuler ».
 * @param {Array<{name:string,is_user:boolean,mes:string,idx:number}>} messages
 * @returns {Array<{text,type,importance,keywords,idx,name,is_user,score,raw}>}
 */
export function heuristicExtract(messages, { minScore = 2, maxPerMessage = 2, withSpeaker = true, maxLen = 260, raw = true } = {}) {
    const out = [];
    for (const msg of messages) {
        if (!msg || !msg.mes) continue;
        const found = [];
        const facts = [];
        for (const s of sentencesOf(String(msg.mes))) {
            if (s.length < 14 || s.length > 420) continue;
            const sf = structuredFacts(s, msg.name);
            if (sf.length) { for (const f of sf) facts.push({ ...f, s }); continue; }
            const r = scoreSentence(s);
            if (r.score >= minScore) found.push({ s, r });
        }
        const seen = new Set();
        for (const f of facts) {
            if (seen.has(f.text) || seen.size >= 4) continue;
            seen.add(f.text);
            out.push({ text: f.text, type: f.type, importance: f.importance, keywords: autoKeywords(`${msg.name} ${f.text}`), idx: msg.idx, name: msg.name, is_user: !!msg.is_user, score: 3, raw: '' });
        }
        if (!raw) continue;
        found.sort((a, b) => b.r.score - a.r.score);
        for (const { s, r } of found.slice(0, maxPerMessage)) {
            let text = s.replace(/^[«"“\s]+|[»"”\s]+$/g, '');
            if (text.length > maxLen) text = text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
            if (withSpeaker && msg.name) text = `${msg.name} : ${text}`;
            out.push({ text, type: r.type, importance: Math.min(5, r.imp), keywords: autoKeywords(s), idx: msg.idx, name: msg.name, is_user: !!msg.is_user, score: r.score, raw: 'extrait' });
        }
    }
    return out;
}

/** Version « une seule phrase courte » d'un message, pour le bouton Mémoriser. */
export function trimMessageForMemory(mes, maxChars = 220) {
    const t = cleanText(mes);
    if (t.length <= maxChars) return t;
    const sents = sentencesOf(mes);
    const scored = sents.map((s, i) => ({ s, i, sc: scoreSentence(s).score }));
    const keep = scored.slice().sort((a, b) => b.sc - a.sc || a.i - b.i);
    const chosen = [];
    let len = 0;
    for (const k of keep) {
        if (len + k.s.length + 1 > maxChars) continue;
        chosen.push(k);
        len += k.s.length + 1;
        if (len > maxChars * 0.6 && chosen.length >= 2) break;
    }
    if (!chosen.length) return t.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
    return chosen.sort((a, b) => a.i - b.i).map((k) => k.s).join(' ');
}

/* ------------------------------------------------------------------ extraction par l'IA : prompt + analyse */

/**
 * Souvenirs déjà connus, en liste compacte (une ligne courte chacun) pour que l'IA ne les répète pas.
 * Priorité : importance décroissante puis récents ; plafonné en caractères (donc en tokens).
 */
export function compactExisting(texts, { maxChars = 1600, lineChars = 140 } = {}) {
    const out = [];
    let used = 0;
    for (const t of texts) {
        let line = cleanText(t);
        if (!line) continue;
        if (line.length > lineChars) line = line.slice(0, lineChars).replace(/\s+\S*$/, '') + '…';
        if (used + line.length + 3 > maxChars) break;
        out.push(line);
        used += line.length + 3;
    }
    return out;
}

const WORD_RUN = 10;
const FIRST_PERSON = /(?:^|[^a-z0-9])(?:j'|t'|(?:je|tu|moi|toi|mon|ma|mes|ton|ta|tes)(?![a-z0-9]))/;
const wordsRaw = (s) => normalize(s).replace(/'/g, ' ').match(/[a-z0-9]+/g) || [];

/**
 * Détecte un « souvenir » qui recopie le chat : guillemets / dialogue, suite de 10 mots identique à un message, ou phrase à la 1ʳᵉ/2ᵉ personne
 * (« je te promets… » = réplique, pas un résumé).
 * Renvoie '' si ça semble reformulé, sinon la raison.
 */
export function copyReason(text, messages) {
    if (/[«»“”"]/.test(String(text))) return 'guillemets';
    const w = wordsRaw(text);
    if (w.length < WORD_RUN) return FIRST_PERSON.test(normalize(text)) ? 'première personne' : '';
    const runs = new Set();
    for (const m of messages || []) {
        const mw = wordsRaw(cleanText(m.mes ?? m));
        for (let i = 0; i + WORD_RUN <= mw.length; i++) runs.add(mw.slice(i, i + WORD_RUN).join(' '));
    }
    for (let i = 0; i + WORD_RUN <= w.length; i++) if (runs.has(w.slice(i, i + WORD_RUN).join(' '))) return 'phrase recopiée';
    if (FIRST_PERSON.test(normalize(text))) return 'première personne';
    return '';
}

export function buildExtractionPrompt(messages, { maxItems = 8, msgChars = 400, existing = [] } = {}) {
    const system = `Tu tiens la mémoire à long terme d'un jeu de rôle (souvent en groupe, avec plusieurs personnages). À partir des messages fournis, tu écris de PETITS SOUVENIRS RÉSUMÉS ET REFORMULÉS, jamais des copies du chat.

Règles :
- Une ligne = un seul fait, de 10 à 25 mots, en français, à la troisième personne, avec les prénoms tels qu'ils apparaissent dans les messages (« Léo… », « Mara… »). Jamais « je », « tu », « nous ».
- Reformule avec tes propres mots. Ne recopie AUCUNE phrase ni réplique : pas de guillemets, pas de dialogue, pas de citation, pas de description de gestes.
- Chaque souvenir doit se comprendre seul, sans avoir lu le chat : nomme les personnes et les lieux (pas de « il », « elle », « ici », « hier » sans précision).
- Sois complet sur ce qui servira plus tard : relations entre personnages (liens, sentiments, tensions), événements marquants, décisions, promesses et engagements, secrets (et qui les connaît), préférences et aversions, état émotionnel durable, lieux et objets importants. Couvre tous les points importants avant de détailler un seul.
- Ignore le décor, les politesses, les gestes passagers, et tout ce qui figure déjà dans les souvenirs connus (ne le répète pas, n'ajoute que du nouveau ou un vrai changement).
- Au maximum ${maxItems} lignes.

Format exact, une ligne par souvenir, rien d'autre :
type|importance(1-5)|souvenir|mot-clé1,mot-clé2
Types : fait, relation, evenement, preference, lieu, objectif (objectif = promesse, décision ou but).

Exemples de bonnes lignes (ne les recopie pas) :
relation|4|Mara se méfie de Théo depuis qu'il lui a menti sur l'origine de la lettre.|Mara,Théo,méfiance
evenement|5|Léo a découvert que le maire Dorian finance en secret la bande qui attaque le village.|Léo,Dorian,secret
objectif|4|Nina a promis à Léo de l'accompagner à Valmont dès que la tempête sera passée.|Nina,Léo,Valmont,promesse
preference|2|Théo déteste le café et boit chaque matin du thé noir sans sucre.|Théo,thé
lieu|3|La vieille tour de guet, au nord du village, sert de refuge secret au groupe.|tour,refuge

Aucune introduction, aucune explication. Si rien de nouveau ni d'important : réponds RIEN.`;
    const known = existing.length ? `Souvenirs déjà connus (à ne pas répéter) :\n${existing.map((t) => `- ${t}`).join('\n')}\n\n` : '';
    const body = messages.map((m) => `${m.name}: ${cleanText(m.mes).slice(0, msgChars)}`).join('\n');
    return { systemPrompt: system, prompt: `${known}Messages :\n${body}\n\nSouvenirs résumés à ajouter (reformulés, 3ᵉ personne) :` };
}

/** Résumé de la scène récente : 2 à 4 phrases, un seul souvenir de type événement. */
export function buildScenePrompt(messages, { msgChars = 700 } = {}) {
    const system = `Tu résumes la scène récente d'un jeu de rôle pour garder la continuité. Écris 2 à 4 phrases courtes, en français, à la troisième personne, avec les prénoms des personnages. Raconte ce qui s'est passé d'important (événements, décisions, révélations, changements de relation, de lieu ou d'état d'esprit) et dans quelle situation la scène s'arrête. Reformule avec tes propres mots : aucune réplique recopiée, aucun guillemet. Le résumé doit se comprendre sans avoir lu le chat. Réponds UNIQUEMENT par le résumé : ni introduction, ni titre, ni liste.`;
    const body = messages.map((m) => `${m.name}: ${cleanText(m.mes).slice(0, msgChars)}`).join('\n');
    return { systemPrompt: system, prompt: `Messages :\n${body}\n\nRésumé de la scène (2 à 4 phrases) :` };
}

/** Nettoie la réponse « résumé de scène » (réflexion, clôtures, titre, guillemets englobants). */
export function parseSceneSummary(raw, maxChars = 600) {
    let t = stripModelNoise(raw).replace(/^\s*(voici|résumé|resume|scène|scene)[^\n:]{0,40}:\s*/i, '');
    t = cleanText(t).replace(/^["«“]\s*|\s*["»”]$/g, '').trim();
    if (t.length > maxChars) {
        const cut = t.slice(0, maxChars);
        const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
        t = end > maxChars * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
    }
    return t.length >= 10 ? t : '';
}

export function buildSummaryPrompt(previous, messages, { maxWords = 120, msgChars = 500 } = {}) {
    const system = `Tu tiens le résumé d'un jeu de rôle pour garder la continuité. Réponds UNIQUEMENT par le résumé mis à jour (max ${maxWords} mots), en phrases courtes, sans introduction.`;
    const body = messages.map((m) => `${m.name}: ${cleanText(m.mes).slice(0, msgChars)}`).join('\n');
    return { systemPrompt: system, prompt: `${previous ? `Résumé actuel :\n${previous}\n\n` : ''}Nouveaux messages :\n${body}\n\nRésumé mis à jour :` };
}

/** Retire la « réflexion » du modèle (<think>…</think>, bloc non fermé = tout est réflexion) et les clôtures ``` . */
export function stripModelNoise(raw) {
    let text = String(raw ?? '');
    text = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
    text = text.replace(/<(think|thinking|reasoning)>[\s\S]*$/i, ''); // réflexion tronquée : rien d'exploitable après
    text = text.replace(/^[\s\S]*?<\/(think|thinking|reasoning)>/i, ''); // balise ouvrante perdue par le serveur
    return text.replace(/```[a-zA-Z0-9_-]*/g, '\n').trim();
}

const JSON_LIST_KEYS = ['faits', 'souvenirs', 'memories', 'facts', 'items', 'resultats', 'résultats', 'results', 'data'];

function tryParseJson(s) {
    try { return JSON.parse(s); } catch { return undefined; }
}

/** Cherche un tableau JSON dans un texte (tolérant : texte autour, objet enveloppe, virgule finale). */
export function findJsonList(text) {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const cands = [t];
    const a0 = t.indexOf('['); const a1 = t.lastIndexOf(']');
    if (a0 >= 0 && a1 > a0) cands.push(t.slice(a0, a1 + 1));
    const o0 = t.indexOf('{'); const o1 = t.lastIndexOf('}');
    if (o0 >= 0 && o1 > o0) cands.push(t.slice(o0, o1 + 1));
    for (const c of cands) {
        const v = tryParseJson(c) ?? tryParseJson(c.replace(/,\s*([\]}])/g, '$1'));
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object') {
            for (const k of JSON_LIST_KEYS) if (Array.isArray(v[k])) return v[k];
            const first = Object.values(v).find(Array.isArray);
            if (first) return first;
        }
    }
    return null;
}

function itemFromJson(e) {
    if (typeof e === 'string') return { body: e, type: 'fait', imp: 3, kws: [] };
    if (!e || typeof e !== 'object') return null;
    const body = e.text ?? e.fait ?? e.fact ?? e.souvenir ?? e.memory ?? e.content ?? e.contenu ?? '';
    let kws = e.keywords ?? e.mots_cles ?? e.motsCles ?? e['mots-clés'] ?? e.mots ?? [];
    if (typeof kws === 'string') kws = kws.split(/[,;]/);
    if (!Array.isArray(kws)) kws = [];
    return { body: String(body), type: normType(e.type ?? e.categorie ?? 'fait'), imp: clampInt(e.importance ?? e.imp ?? e.score, 1, 5, 3), kws: kws.map((k) => String(k).trim()).filter(Boolean) };
}

const PREAMBLE = /^(voici|here\b|ci-dessous|faits? (à|a) retenir|résultat|resultat|réponse|reponse|ok\b|d'accord|bien sûr|bien sur|sure\b)/i;

export function parseExtraction(raw, maxItems = 6) {
    const out = [];
    const text = stripModelNoise(raw);
    if (!text || /^\s*rien\s*\.?\s*$/i.test(text)) return out;
    const push = (body, type, imp, kws) => {
        body = cleanText(body).replace(/^["«]|["»]$/g, '');
        if (body.length < 6) return false;
        out.push({ text: body.slice(0, 300), type, importance: imp, keywords: kws.slice(0, 5) });
        return out.length >= maxItems;
    };
    // 1) JSON (tableau, objet enveloppe, texte autour)
    const list = /[\[{]/.test(text) ? findJsonList(text) : null;
    if (list) {
        for (const e of list) {
            const it = itemFromJson(e);
            if (it && push(it.body, it.type, it.imp, it.kws)) break;
        }
        return out;
    }
    // 2) lignes « type|importance|fait|mots-clés »
    for (let line of text.split(/\n+/)) {
        line = line.trim().replace(/^[-*•\d.)\s]+/, '').trim();
        if (!line || /^rien\b/i.test(line)) continue;
        if (!line.includes('|') && (/[:：]\s*$/.test(line) || PREAMBLE.test(line) || /^[\[\]{}(),]+$/.test(line))) continue;
        let type = 'fait';
        let imp = 3;
        let body = line;
        let kws = [];
        const br = line.match(/^\[(\w+)\s*[|:/]?\s*(\d)?\]\s*(.*)$/);
        if (br) {
            type = normType(br[1]); imp = clampInt(br[2], 1, 5, 3); body = br[3];
        } else if (line.includes('|')) {
            const parts = line.split('|').map((p) => p.trim());
            if (parts.length >= 3) {
                type = normType(parts[0].replace(/[\[\]]/g, ''));
                imp = clampInt(parts[1].replace(/\D/g, ''), 1, 5, 3);
                body = parts[2];
                kws = (parts[3] || '').split(/[,;]/).map((k) => k.trim()).filter(Boolean);
            } else {
                body = parts.join(' ');
            }
        }
        if (push(body, type, imp, kws)) break;
    }
    return out;
}

/** Clé de dédoublonnage « rejeté » : tokens triés. */
export function dedupeKey(text) {
    return [...tokenSet(text)].sort().join(' ');
}
