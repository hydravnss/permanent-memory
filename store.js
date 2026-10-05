/**
 * Mémoire Permanente — réglages, stockage persistant, portées (scopes), budget IA.
 *
 * Stockage :
 *  - réglages  : extension_settings.permanent_memory (settings.json de l'utilisateur ST)
 *  - souvenirs : fichier utilisateur  data/<user>/user/files/permanent_memory_store.json
 *                (envoyé via /api/files/upload) — indépendant des chats : survit à leur suppression
 *  - souvenirs « chat » : chat_metadata.permanent_memory (dans le fichier du chat lui-même)
 */
import * as core from './core.js';

export const MODULE = 'permanent_memory';
export const PROMPT_KEY = 'permanent_memory';
export const FILE = 'permanent_memory_store.json';
export const LOG = '[Mémoire Permanente]';
export const VERSION = '1.0.1';
export const SETTINGS_VERSION = 4;
export const STORE_VERSION = 1;

export const ctx = () => globalThis.SillyTavern.getContext();

export const DEFAULTS = Object.freeze({
    settingsVersion: SETTINGS_VERSION,
    enabled: true,
    preset: 'equilibre',
    // injection
    maxMemories: 6,
    maxTokens: 400,
    scanDepth: 4,
    minScore: 0.5,
    position: 1, // 0 = après le prompt système, 1 = dans le chat (profondeur), 2 = avant le prompt
    depth: 4,
    role: 0, // 0 système, 1 utilisateur, 2 assistant
    header: '[Mémoire de {{char}} :',
    includeChat: true,
    useWorld: true,
    usePersona: false,
    groupMode: 'speaking', // (hérité, plus utilisé depuis 1.0.1 — voir groupAllMembers)
    groupAllMembers: true, // groupes : injecter les souvenirs de TOUS les membres (+ groupe + monde) ; le perso qui parle est favorisé
    groupIncludeMuted: true, // groupes : inclure aussi les membres « muets » (désactivés dans le groupe)
    // création
    heuristics: false, // 1.2.0 : analyse locale automatique à chaque message désactivée par défaut (elle proposait surtout des faits sans intérêt)
    heuristicsMinScore: 2,
    scanRaw: false, // 1.2.0 : « Analyser l’historique (gratuit) » ne propose plus les extraits bruts, sauf si on le réactive
    minImportance: 3, // 1.2.0 : faits proposés par l’IA d’importance inférieure = écartés (« faits mineurs ignorés »)
    inboxMax: 40,
    messageButton: true,
    // IA (tout est coupé par défaut)
    neverAI: false,
    autoExtract: false,
    autoEvery: 10,
    autoMaxItems: 8, // souvenirs max par extraction (1.1.0 : 4 → 8, pour des résumés plus complets)
    autoMaxTokens: 700, // large : 8 souvenirs de ~25 mots ≈ 450 tokens ; un modèle « à réflexion » (DeepSeek reasoner…) consomme aussi ces tokens avant de répondre
    extractMessages: 40, // extraction manuelle : nombre de derniers messages analysés
    extractInputTokens: 4000, // extraction : budget d’entrée (les plus anciens messages sont retirés au-delà) ; 1.1.0 : 3000 → 4000 (le prompt de résumés est plus long)
    autoMsgChars: 400,
    sceneMessages: 12, // « Résumer les derniers messages » : nombre de messages résumés
    autoToInbox: true,
    maxCallsPerDay: 5,
    maxTokensPerMonth: 30000,
    autoSummary: false,
    summaryEvery: 40,
    summaryMaxTokens: 250,
    // entretien
    dedupThreshold: 0.6,
    autoArchive: false,
    archiveDays: 60,
    lastArchiveDay: '',
    // interface
    wand: true,
    floating: false,
    floatX: 92,
    floatY: 62,
    floatSize: 46,
    stats: {
        day: '', callsToday: 0, tokensToday: 0,
        month: '', callsMonth: 0, tokensMonth: 0,
        callsTotal: 0, tokensTotal: 0, blocked: 0,
        injections: 0, injectedTokensTotal: 0, lastInjectedTokens: 0,
    },
});

export const PRESETS = Object.freeze({
    economie: { label: '💰 Économie', maxMemories: 4, maxTokens: 200, scanDepth: 3, autoExtract: false, autoSummary: false, maxCallsPerDay: 2, maxTokensPerMonth: 10000 },
    equilibre: { label: '⚖️ Équilibré', maxMemories: 6, maxTokens: 400, scanDepth: 4, autoExtract: false, autoSummary: false, maxCallsPerDay: 5, maxTokensPerMonth: 30000 },
    confort: { label: '🛋️ Confort', maxMemories: 10, maxTokens: 800, scanDepth: 5, maxCallsPerDay: 10, maxTokensPerMonth: 80000 },
});

const NUM = {
    maxMemories: [1, 30], maxTokens: [50, 3000], scanDepth: [1, 10], position: [0, 2], depth: [0, 50], role: [0, 2],
    heuristicsMinScore: [1, 6], minImportance: [1, 5], inboxMax: [5, 200], autoEvery: [2, 100], autoMaxItems: [1, 10], autoMaxTokens: [50, 4000], extractMessages: [4, 200], extractInputTokens: [500, 20000], autoMsgChars: [100, 2000], sceneMessages: [4, 60],
    maxCallsPerDay: [0, 100], maxTokensPerMonth: [0, 5000000], summaryEvery: [10, 500], summaryMaxTokens: [50, 1000], archiveDays: [7, 730],
    floatX: [0, 100], floatY: [0, 100], floatSize: [34, 90],
};
const FLOAT = { minScore: [0.1, 5], dedupThreshold: [0.3, 1] };

export function S() {
    const es = ctx().extensionSettings;
    if (!es[MODULE] || typeof es[MODULE] !== 'object') es[MODULE] = {};
    const s = es[MODULE];
    const prevVersion = Number(s.settingsVersion) || 1;
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = k === 'stats' ? { ...v } : v;
    }
    if (!s.stats || typeof s.stats !== 'object') s.stats = { ...DEFAULTS.stats };
    for (const [k, v] of Object.entries(DEFAULTS.stats)) if (s.stats[k] === undefined) s.stats[k] = v;
    for (const [k, [lo, hi]] of Object.entries(NUM)) s[k] = core.clampInt(s[k], lo, hi, DEFAULTS[k]);
    for (const [k, [lo, hi]] of Object.entries(FLOAT)) { const n = Number(s[k]); s[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULTS[k]; }
    if (!['speaking', 'present'].includes(s.groupMode)) s.groupMode = 'speaking';
    if (typeof s.header !== 'string') s.header = DEFAULTS.header;
    s.groupAllMembers = s.groupAllMembers !== false;
    s.groupIncludeMuted = s.groupIncludeMuted !== false;
    if (prevVersion < 3) migrateTo3(s);
    if (prevVersion < 4) migrateTo4(s);
    s.settingsVersion = SETTINGS_VERSION;
    return s;
}

/**
 * Migration 1.1.0 : seules les valeurs ÉGALES à l'ancien défaut sont remplacées (jamais une valeur personnalisée).
 *  - plafond d'appels / jour : 2 → 5 (sauf si le préréglage « Économie », qui vaut 2 volontairement, est actif) ;
 *  - faits max par extraction : 4 → 8 ; réponse de l'IA : 400 → 700 tokens ; budget d'entrée : 3000 → 4000 (prompt de résumés plus complets).
 */
function migrateTo3(s) {
    if (s.maxCallsPerDay === 2 && s.preset !== 'economie') s.maxCallsPerDay = DEFAULTS.maxCallsPerDay;
    if (s.autoMaxItems === 4) s.autoMaxItems = DEFAULTS.autoMaxItems;
    if (s.autoMaxTokens === 400) s.autoMaxTokens = DEFAULTS.autoMaxTokens;
    if (s.extractInputTokens === 3000) s.extractInputTokens = DEFAULTS.extractInputTokens;
    try { saveSettings(); } catch { /* ignore */ }
}

/**
 * Migration 1.2.0 : l'analyse locale automatique à chaque message passe à « off » si l'ancien défaut (on) est en place.
 * (minImportance et scanRaw, nouveaux, prennent leur défaut.)
 */
function migrateTo4(s) {
    if (s.heuristics === true) s.heuristics = false;
    try { saveSettings(); } catch { /* ignore */ }
}

export const saveSettings = () => ctx().saveSettingsDebounced();

export function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return false;
    const s = S();
    for (const [k, v] of Object.entries(p)) if (k !== 'label') s[k] = v;
    s.preset = name;
    saveSettings();
    return true;
}

/* ------------------------------------------------------------------ notifications */

export function toast(kind, msg, opts = {}) {
    try {
        const t = globalThis.toastr;
        if (t && t[kind]) t[kind](msg, 'Mémoire Permanente', { timeOut: 3500, ...opts });
        else console.log(LOG, msg);
    } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ stockage fichier */

export const store = { version: STORE_VERSION, appVersion: VERSION, scopes: {}, candidates: [], rejected: [] };
const status = { loaded: false, canSave: false, error: null, saving: false, dirty: false, lastSave: 0, saves: 0 };
export const storeStatus = status;
let saveTimer = null;
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emitChange = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.warn(LOG, e); } } };

function normalizeStore(raw) {
    const out = { version: STORE_VERSION, appVersion: VERSION, scopes: {}, candidates: [], rejected: [] };
    if (!raw || typeof raw !== 'object') return out;
    const taken = new Set();
    for (const [key, sc] of Object.entries(raw.scopes || {})) {
        if (!sc || typeof sc !== 'object') continue;
        out.scopes[key] = { name: String(sc.name || key), kind: sc.kind || key.split(':')[0], memories: [] };
        for (const m of Array.isArray(sc.memories) ? sc.memories : []) {
            const mm = core.makeMemory(m, taken);
            if (!mm.text) continue;
            taken.add(mm.id);
            out.scopes[key].memories.push(mm);
        }
    }
    for (const c of Array.isArray(raw.candidates) ? raw.candidates : []) {
        if (!c || !c.text || !c.scope) continue;
        // anciens candidats « heuristique » (1.0.x) = phrases brutes : ils sont signalés « extrait brut »
        const raw = c.raw === 'copie' ? 'copie' : (c.raw || (c.raw === undefined && (c.origin || 'heuristique') === 'heuristique')) ? 'extrait' : '';
        out.candidates.push({ ...core.makeMemory(c, taken), scope: String(c.scope), origin: c.origin || 'heuristique', chat: c.chat || null, raw });
    }
    out.rejected = (Array.isArray(raw.rejected) ? raw.rejected : []).filter((x) => typeof x === 'string').slice(-300);
    return out;
}

export async function loadStore() {
    try {
        const r = await fetch(`/user/files/${FILE}?t=${Date.now()}`, { cache: 'no-store' });
        if (r.status === 404) {
            Object.assign(store, normalizeStore(null));
            status.loaded = true; status.canSave = true; status.error = null;
        } else if (r.ok) {
            const txt = await r.text();
            const raw = JSON.parse(txt);
            Object.assign(store, normalizeStore(raw));
            await migrateBackup(raw, txt);
            status.loaded = true; status.canSave = true; status.error = null;
        } else {
            throw new Error(`HTTP ${r.status}`);
        }
    } catch (e) {
        status.error = String(e?.message || e);
        status.loaded = false;
        status.canSave = false; // on n'écrase JAMAIS le fichier si la lecture a échoué
        console.warn(LOG, 'lecture du stockage impossible', e);
    }
    emitChange();
    return status.loaded;
}

/** Migration 1.0.1 : copie de sécurité (une seule fois) du fichier tel qu'il était, avant toute réécriture. */
async function migrateBackup(raw, txt) {
    try {
        if (raw?.appVersion === VERSION) return;
        const n = Object.values(raw?.scopes || {}).reduce((a, sc) => a + (sc?.memories?.length || 0), 0);
        if (!n) return;
        const name = `permanent_memory_store_backup_avant_${VERSION}.json`;
        const ex = await fetch(`/user/files/${name}?t=${Date.now()}`, { cache: 'no-store' });
        if (ex.ok) return;
        await uploadUserFile(name, JSON.parse(txt));
        console.log(LOG, `migration ${VERSION} : copie de sécurité écrite (${n} souvenirs)`);
    } catch (e) { console.warn(LOG, 'copie de sécurité de migration impossible', e); }
}

function toB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

export async function uploadUserFile(name, obj) {
    const r = await fetch('/api/files/upload', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ name, data: toB64(JSON.stringify(obj)) }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return true;
}

export function markDirty() {
    status.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveStoreNow(); }, 700);
}

export async function saveStoreNow() {
    clearTimeout(saveTimer);
    if (!status.canSave) {
        if (!status.loaded) await loadStore();
        if (!status.canSave) return false;
    }
    if (status.saving) { markDirty(); return false; }
    status.saving = true;
    try {
        await uploadUserFile(FILE, store);
        status.dirty = false; status.lastSave = Date.now(); status.saves++; status.error = null;
        return true;
    } catch (e) {
        status.error = String(e?.message || e);
        toast('error', `Sauvegarde des souvenirs impossible (${status.error})`);
        return false;
    } finally {
        status.saving = false;
        emitChange();
    }
}

/* ------------------------------------------------------------------ portées (scopes) */

export function chatData(create = true) {
    const md = ctx().chatMetadata;
    if (!md || typeof md !== 'object') return null;
    if (!md[MODULE] || typeof md[MODULE] !== 'object') {
        if (!create) return null;
        md[MODULE] = { memories: [], lastExtractIdx: undefined, heurIdx: undefined, lastSummaryIdx: -1 };
    }
    const d = md[MODULE];
    if (!Array.isArray(d.memories)) d.memories = [];
    return d;
}
export const saveChatData = () => { try { ctx().saveMetadataDebounced(); } catch { /* ignore */ } };

export function setUserAvatarGetter(fn) { userAvatarFn = fn; }
let userAvatarFn = () => '';
export const currentPersonaAvatar = () => { try { return userAvatarFn() || ''; } catch { return ''; } };

export function charName(avatar) {
    return ctx().characters.find((c) => c.avatar === avatar)?.name || store.scopes[`char:${avatar}`]?.name || avatar;
}
export function avatarByName(name) {
    return ctx().characters.find((c) => c.name === name)?.avatar || null;
}

export function currentGroup() {
    const c = ctx();
    return c.groupId ? c.groups.find((g) => String(g.id) === String(c.groupId)) || null : null;
}
export function groupMembers() {
    const g = currentGroup();
    if (!g) return [];
    const dis = new Set(g.disabled_members || []);
    return (g.members || []).filter((a) => !dis.has(a));
}
export function speakerAvatar() {
    const c = ctx();
    return c.characterId !== undefined && c.characters[c.characterId] ? c.characters[c.characterId].avatar : null;
}

/** Portées que l'on peut CONSULTER/éditer dans le contexte courant (toutes, même celles non injectées). */
export function viewerScopes() {
    const c = ctx();
    const out = [];
    const g = currentGroup();
    if (g) {
        for (const av of g.members || []) out.push({ key: `char:${av}`, kind: 'char', name: charName(av), label: `🎭 ${charName(av)}` });
        out.push({ key: `group:${g.id}`, kind: 'group', name: g.name, label: `👥 Tout le groupe « ${g.name} »` });
    } else if (c.characterId !== undefined && c.characters[c.characterId]) {
        const ch = c.characters[c.characterId];
        out.push({ key: `char:${ch.avatar}`, kind: 'char', name: ch.name, label: `🎭 ${ch.name}` });
    }
    if (c.characterId !== undefined || c.groupId) out.push({ key: 'chat', kind: 'chat', name: 'Ce chat', label: '💬 Ce chat uniquement' });
    const pa = currentPersonaAvatar();
    if (pa) out.push({ key: `persona:${pa}`, kind: 'persona', name: c.name1, label: `🙋 Persona « ${c.name1} »` });
    out.push({ key: 'world', kind: 'world', name: 'Monde', label: '🌍 Monde (partagé)' });
    return out;
}

/**
 * Portées INJECTÉES pour la génération en cours.
 * `speakerOverride` (avatar) sert à simuler « si tel perso parle » (bouton Tester l'injection).
 * En groupe (par défaut, groupAllMembers) : TOUS les membres + le groupe + le monde ; le perso qui parle (s'il est connu)
 * est seulement favorisé. Avant le choix de l'orateur par ST, il est inconnu : on injecte quand même tous les membres.
 */
export function activeScopes(speakerOverride) {
    const s = S();
    const c = ctx();
    const out = [];
    const g = currentGroup();
    if (g) {
        const spk = speakerOverride === undefined ? speakerAvatar() : speakerOverride;
        let members = groupMembers();
        if (s.groupIncludeMuted) members = (g.members || []).slice();
        let chars = members;
        if (!s.groupAllMembers && spk && members.includes(spk)) chars = [spk]; // mode isolé (ancien comportement), optionnel
        else if (spk && !chars.includes(spk)) chars = [...chars, spk];
        for (const av of chars) out.push({ key: `char:${av}`, kind: 'char', name: charName(av), owner: charName(av), boost: av === spk ? 1.25 : 1, speaker: av === spk });
        out.push({ key: `group:${g.id}`, kind: 'group', name: g.name });
    } else if (c.characterId !== undefined && c.characters[c.characterId]) {
        const ch = c.characters[c.characterId];
        out.push({ key: `char:${ch.avatar}`, kind: 'char', name: ch.name });
    }
    if (s.includeChat && (c.characterId !== undefined || c.groupId)) out.push({ key: 'chat', kind: 'chat', name: 'Ce chat' });
    if (s.usePersona && currentPersonaAvatar()) out.push({ key: `persona:${currentPersonaAvatar()}`, kind: 'persona', name: c.name1 });
    if (s.useWorld) out.push({ key: 'world', kind: 'world', name: 'Monde' });
    return out;
}

/** Souvenirs d'une portée par état : total / utilisables / épinglés utilisables / désactivés / archivés. */
export function scopeCounts(key) {
    const list = getList(key, false);
    const r = { total: list.length, usable: 0, pinned: 0, disabled: 0, archived: 0 };
    for (const m of list) {
        if (m.archived) r.archived++;
        else if (!m.enabled) r.disabled++;
        else { r.usable++; if (m.pinned) r.pinned++; }
    }
    return r;
}

/**
 * Diagnostic : pour les portées actives, les compteurs ; pour les portées qui contiennent des souvenirs mais NE SONT PAS
 * injectées dans ce contexte, la raison. C'est ce que l'onglet Injection affiche quand « rien n'est injecté ».
 */
export function scopeReport(active) {
    const s = S();
    const c = ctx();
    const g = currentGroup();
    const activeKeys = new Set(active.map((x) => x.key));
    const rows = active.map((sc) => ({ key: sc.key, label: scopeLabel(sc.key), speaker: !!sc.speaker, ...scopeCounts(sc.key) }));
    const ignored = [];
    const memberSet = new Set(g ? g.members || [] : []);
    const consider = [...Object.keys(store.scopes), ...(chatData(false) ? ['chat'] : [])];
    for (const key of consider) {
        if (activeKeys.has(key)) continue;
        const cnt = scopeCounts(key);
        if (!cnt.total) continue;
        const kind = key.split(':')[0];
        let why = 'portée non utilisée dans ce contexte';
        if (kind === 'char') {
            const av = key.slice(5);
            if (g && !memberSet.has(av)) why = `ce personnage n’est pas membre du groupe « ${g.name} »`;
            else if (g && (g.disabled_members || []).includes(av) && !s.groupIncludeMuted) why = 'membre muet exclu (réglage « inclure les membres muets » décoché)';
            else if (g) why = 'réglage « tous les membres du groupe » décoché : seul le perso qui parle est injecté';
            else if (!g && c.characterId !== undefined) why = 'ce personnage n’est pas le personnage du chat actuel';
            else why = 'aucun chat de personnage ou de groupe ouvert';
        } else if (kind === 'group') why = g ? 'souvenirs d’un autre groupe' : 'aucun groupe ouvert';
        else if (kind === 'persona') why = 'réglage « Inclure les souvenirs du persona » désactivé ou autre persona';
        else if (kind === 'world') why = 'réglage « Monde » désactivé';
        else if (kind === 'chat') why = 'réglage « Inclure les souvenirs propres au chat » désactivé';
        ignored.push({ key, label: scopeLabel(key), why, ...cnt });
    }
    return { rows, ignored, enabled: s.enabled, group: g ? { id: g.id, name: g.name, members: (g.members || []).length, muted: (g.disabled_members || []).length } : null };
}

/** Liste (modifiable en place) des souvenirs d'une portée. */
export function getList(key, create = true) {
    if (key === 'chat') return chatData(create)?.memories || [];
    let sc = store.scopes[key];
    if (!sc) {
        if (!create) return [];
        const kind = key.split(':')[0];
        const name = kind === 'char' ? charName(key.slice(5)) : kind === 'world' ? 'Monde' : kind === 'group' ? (ctx().groups.find((g) => `group:${g.id}` === key)?.name || key) : kind === 'persona' ? ctx().name1 : key;
        sc = store.scopes[key] = { name, kind, memories: [] };
    }
    return sc.memories;
}

export function scopeLabel(key) {
    if (key === 'chat') return '💬 Ce chat';
    if (key === 'world') return '🌍 Monde';
    const sc = store.scopes[key];
    const kind = key.split(':')[0];
    const nm = kind === 'char' ? (ctx().characters?.find((c) => c.avatar === key.slice(5))?.name || sc?.name || key) : (sc?.name || key);
    return kind === 'char' ? `🎭 ${nm}` : kind === 'group' ? `👥 ${nm}` : kind === 'persona' ? `🙋 ${nm}` : nm;
}

function takenIds() {
    const t = new Set();
    for (const sc of Object.values(store.scopes)) for (const m of sc.memories) t.add(m.id);
    for (const m of chatData(false)?.memories || []) t.add(m.id);
    for (const m of store.candidates) t.add(m.id);
    return t;
}

function persistScope(key) {
    if (key === 'chat') saveChatData();
    else markDirty();
    emitChange();
}

export function addMemory(key, fields, { allowDuplicate = true } = {}) {
    const list = getList(key, true);
    const dup = core.isNearDuplicate(fields.text || '', list, 0.8);
    if (dup && !allowDuplicate) return { entry: null, duplicate: dup };
    const idx = fields.src?.idx ?? null;
    const m = core.makeMemory({ ...fields, src: fields.src || { idx, chat: ctx().getCurrentChatId?.() ?? null } }, takenIds());
    if (!m.text) return { entry: null, duplicate: null };
    list.push(m);
    persistScope(key);
    return { entry: m, duplicate: dup || null };
}

export function findMemory(idOrPrefix) {
    const id = String(idOrPrefix || '').trim().toLowerCase();
    if (!id) return null;
    const all = [];
    for (const [key, sc] of Object.entries(store.scopes)) for (const m of sc.memories) all.push({ key, m });
    for (const m of chatData(false)?.memories || []) all.push({ key: 'chat', m });
    const exact = all.find((x) => x.m.id === id);
    if (exact) return exact;
    const pre = all.filter((x) => x.m.id.startsWith(id));
    return pre.length === 1 ? pre[0] : null;
}

export function updateMemory(key, id, patch) {
    const m = getList(key, false).find((x) => x.id === id);
    if (!m) return null;
    if ('text' in patch) m.text = core.cleanText(patch.text).slice(0, 600);
    if ('type' in patch) m.type = core.normType(patch.type);
    if ('importance' in patch) m.importance = core.clampInt(patch.importance, 1, 5, m.importance);
    if ('keywords' in patch) m.keywords = core.makeMemory({ text: 'x', keywords: patch.keywords }).keywords;
    for (const f of ['pinned', 'enabled', 'archived']) if (f in patch) m[f] = !!patch[f];
    persistScope(key);
    return m;
}

export function deleteMemory(key, id) {
    const list = getList(key, false);
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    persistScope(key);
    return true;
}

export function moveMemory(fromKey, id, toKey) {
    if (fromKey === toKey) return true;
    const list = getList(fromKey, false);
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const [m] = list.splice(i, 1);
    getList(toKey, true).push(m);
    persistScope(fromKey);
    persistScope(toKey);
    return true;
}

/** Tous les souvenirs (portée courante + toutes les portées du fichier). */
export function allEntries() {
    const out = [];
    for (const [key, sc] of Object.entries(store.scopes)) for (const m of sc.memories) out.push({ key, m });
    for (const m of chatData(false)?.memories || []) out.push({ key: 'chat', m });
    return out;
}

/* ------------------------------------------------------------------ candidats (boîte de réception) */

export function candidatesFor(keys) {
    const set = new Set(keys);
    return store.candidates.filter((c) => set.has(c.scope));
}

export function addCandidate(c) {
    const s = S();
    const key = core.dedupeKey(c.text);
    if (store.rejected.includes(key)) return null;
    const existing = [...getList(c.scope, false)];
    if (core.isNearDuplicate(c.text, existing, 0.7)) return null;
    if (core.isNearDuplicate(c.text, store.candidates.filter((x) => x.scope === c.scope), 0.7)) return null;
    const cand = { ...core.makeMemory(c, takenIds()), scope: c.scope, origin: c.origin || 'local', chat: ctx().getCurrentChatId?.() ?? null, raw: c.raw === 'copie' ? 'copie' : c.raw ? 'extrait' : '' };
    if (!cand.text) return null;
    store.candidates.push(cand);
    while (store.candidates.length > s.inboxMax) store.candidates.shift();
    markDirty();
    emitChange();
    return cand;
}

export function acceptCandidate(id, patch = {}) {
    const i = store.candidates.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const c = store.candidates[i];
    const key = patch.scope || c.scope;
    store.candidates.splice(i, 1);
    const r = addMemory(key, { ...c, ...patch, id: undefined }, { allowDuplicate: true });
    markDirty();
    emitChange();
    return r.entry;
}

export function rejectCandidate(id) {
    const i = store.candidates.findIndex((c) => c.id === id);
    if (i < 0) return false;
    const [c] = store.candidates.splice(i, 1);
    store.rejected.push(core.dedupeKey(c.text));
    if (store.rejected.length > 300) store.rejected.shift();
    markDirty();
    emitChange();
    return true;
}

/* ------------------------------------------------------------------ budget IA */

const pad = (n) => String(n).padStart(2, '0');
export function todayKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function rollStats() {
    const st = S().stats;
    const d = todayKey();
    const m = d.slice(0, 7);
    if (st.day !== d) { st.day = d; st.callsToday = 0; st.tokensToday = 0; }
    if (st.month !== m) { st.month = m; st.tokensMonth = 0; st.callsMonth = 0; }
    return st;
}

/** Garde-fou dur : retourne { ok, reason }. Aucun appel IA ne doit partir si ok === false. */
export function budgetCheck(estTokens = 0) {
    const s = S();
    const st = rollStats();
    if (s.neverAI) return { ok: false, reason: 'Mode « Ne jamais appeler l’IA » activé' };
    if (st.callsToday >= s.maxCallsPerDay) return { ok: false, reason: `Plafond quotidien atteint (${st.callsToday}/${s.maxCallsPerDay} appels)` };
    if (st.tokensMonth + estTokens > s.maxTokensPerMonth) return { ok: false, reason: `Plafond mensuel de tokens atteint (${st.tokensMonth}+${estTokens} > ${s.maxTokensPerMonth})` };
    return { ok: true, reason: '' };
}

export function recordCall(tokens) {
    const st = rollStats();
    st.callsToday++; st.callsMonth++; st.callsTotal++;
    st.tokensToday += tokens; st.tokensMonth += tokens; st.tokensTotal += tokens;
    saveSettings();
    emitChange();
}
export function recordBlocked() { const st = rollStats(); st.blocked++; saveSettings(); emitChange(); }
export function resetStats() { const s = S(); s.stats = { ...DEFAULTS.stats }; rollStats(); saveSettings(); emitChange(); }

/* ------------------------------------------------------------------ import / export / sauvegarde */

export function exportData(keys = null) {
    const out = { format: 'permanent-memory', version: STORE_VERSION, exportedAt: new Date().toISOString(), scopes: {} };
    for (const [key, sc] of Object.entries(store.scopes)) {
        if (keys && !keys.includes(key)) continue;
        out.scopes[key] = { name: sc.name, kind: sc.kind, memories: sc.memories };
    }
    const cm = chatData(false)?.memories;
    if (cm?.length && (!keys || keys.includes('chat'))) out.scopes.chat = { name: 'Ce chat', kind: 'chat', memories: cm };
    return out;
}

/** mode : 'fusion' (ajoute ce qui manque, par id puis quasi-doublon) | 'remplacer' (remplace les portées présentes dans le fichier) */
export function importData(obj, mode = 'fusion') {
    if (!obj || typeof obj !== 'object' || !obj.scopes || typeof obj.scopes !== 'object') throw new Error('Fichier invalide (pas un export Mémoire Permanente)');
    const clean = normalizeStore({ scopes: obj.scopes });
    let added = 0; let skipped = 0;
    for (const [key, sc] of Object.entries(clean.scopes)) {
        if (key === 'chat' && !chatData(true)) { skipped += sc.memories.length; continue; }
        const list = getList(key, true);
        if (key !== 'chat' && store.scopes[key] && sc.name) store.scopes[key].name = store.scopes[key].name || sc.name;
        if (mode === 'remplacer') { list.length = 0; }
        const ids = new Set(list.map((m) => m.id));
        const taken = takenIds();
        for (const m of sc.memories) {
            if (ids.has(m.id) || (mode === 'fusion' && core.isNearDuplicate(m.text, list, 0.9))) { skipped++; continue; }
            if (taken.has(m.id)) m.id = core.shortId(taken);
            list.push(m); ids.add(m.id); taken.add(m.id); added++;
        }
        persistScope(key);
    }
    return { added, skipped };
}

export async function backupToServer() {
    const name = `permanent_memory_backup_${todayKey()}.json`;
    await uploadUserFile(name, exportData(null));
    return name;
}

export function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}
