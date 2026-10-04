/**
 * Mémoire Permanente — moteur : injection dans le prompt, extraction, résumé, entretien.
 * Les appels à l'IA (generateRaw) passent TOUS par callAI(), protégé par le budget dur.
 */
import * as core from './core.js';
import * as st from './store.js';

const { ctx, S, LOG } = st;

export const state = {
    lastInjection: null, // dernière injection réellement envoyée (hors simulation « à blanc »)
    history: [], // 20 dernières injections { type, dry, tokens, texts }
    preview: null, // dernier aperçu calculé à la demande
    running: false, // un appel IA est en cours
    lastAIError: '',
    capNotifiedDay: '',
    drafted: false, // groupe : un membre a été choisi pour répondre (donc la génération en cours est la vraie)
};

export async function countTokens(text) {
    if (!text) return 0;
    try { return await ctx().getTokenCountAsync(text); } catch { return core.estTokens(text); }
}

/* ------------------------------------------------------------------ injection */

function chatTexts(type) {
    const chat = ctx().chat || [];
    let msgs = chat.filter((m) => m && !m.is_system && typeof m.mes === 'string');
    // régénération / swipe : le dernier message du bot sera remplacé, il ne doit pas guider la sélection
    if ((type === 'regenerate' || type === 'swipe') && msgs.length && !msgs[msgs.length - 1].is_user) msgs = msgs.slice(0, -1);
    return msgs.slice(-Math.max(1, S().scanDepth)).map((m) => core.cleanText(m.mes));
}

export function collectItems(scopes = st.activeScopes()) {
    const items = [];
    for (const sc of scopes) {
        for (const m of st.getList(sc.key, false)) {
            if (!m.enabled || m.archived) continue;
            items.push({ m, scopeKey: sc.key, owner: sc.owner || null, boost: sc.boost || 1 });
        }
    }
    return items;
}

function buildText(picked) {
    if (!picked.length) return '';
    const header = ctx().substituteParams(S().header || '');
    return `${header}\n${picked.map((p) => p.line).join('\n')}\n]`;
}

/**
 * Calcule le bloc à injecter (100 % local). `override` remplace les messages récents (simulation).
 */
function pendingText(type, params, dryRun) {
    // ST ajoute le message de l'utilisateur au chat APRÈS GENERATION_STARTED : à ce moment il est encore dans la zone de saisie.
    if (dryRun || params?.automatic_trigger || !['normal', 'impersonate', undefined].includes(type)) return '';
    const t = String(globalThis.document?.getElementById('send_textarea')?.value || '').trim();
    return t && !t.startsWith('/') ? core.cleanText(t) : '';
}

/** Nom lisible de l'orateur (avatar) ; '' si inconnu. */
export function speakerName(av) { return av ? st.charName(av) : ''; }

/** Explique en français POURQUOI rien (ou peu) n'est injecté : portée utilisée, compteurs, filtres, portées ignorées. */
function explain(report, speakerAv, items, picked) {
    const out = [];
    const c = ctx();
    if (!S().enabled) out.push('L’extension est désactivée (réglage « Activer la mémoire permanente »).');
    const g = report.group;
    out.push(g
        ? `Contexte : groupe « ${g.name} » (${g.members} membre(s)${g.muted ? `, dont ${g.muted} muet(s)` : ''}) — perso qui parle : ${speakerAv ? speakerName(speakerAv) : 'pas encore choisi par SillyTavern (tous les membres sont donc pris en compte)'}.`
        : (c.characterId !== undefined ? `Contexte : chat de ${c.characters[c.characterId]?.name || 'personnage'}.` : 'Contexte : aucun chat ouvert.'));
    out.push(`Portées lues : ${report.rows.map((r) => `${r.label} = ${r.usable} utilisable(s)${r.pinned ? ` dont ${r.pinned} épinglé(s)` : ''}`).join(' · ') || '(aucune)'}.`);
    const dis = report.rows.reduce((a, r) => a + r.disabled, 0);
    const arc = report.rows.reduce((a, r) => a + r.archived, 0);
    if (dis || arc) out.push(`Filtrés : ${dis} désactivé(s), ${arc} archivé(s) (ni l’un ni l’autre n’est injecté).`);
    for (const ig of report.ignored) out.push(`⚠️ ${ig.label} : ${ig.total} souvenir(s) NON injecté(s) — ${ig.why}. (Dans l’éditeur, « Attribuer à » permet de les rattacher au groupe ou au monde.)`);
    if (!items.length && !report.ignored.length) out.push('Il n’existe aucun souvenir utilisable dans ce contexte.');
    else if (items.length && !picked.length) out.push('Aucun souvenir n’est épinglé et aucun n’est assez pertinent par rapport aux derniers messages (épingle-les pour les injecter toujours).');
    return out;
}

export async function buildInjection({ type = 'normal', override = null, pending = '', speaker } = {}) {
    const s = S();
    const scopes = st.activeScopes(speaker);
    const speakerAv = speaker === undefined ? st.speakerAvatar() : speaker;
    const items = collectItems(scopes);
    const texts = override != null ? [String(override)] : [...chatTexts(type), ...(pending ? [pending] : [])].slice(-Math.max(1, s.scanDepth));
    const c = ctx();
    const ignoreNames = [c.name1, speakerAv ? speakerName(speakerAv) : c.characters?.[c.characterId]?.name].filter(Boolean);
    const header = ctx().substituteParams(s.header || '');
    const headerTokens = core.estTokens(header) + 2;
    const sel = core.selectMemories(items, texts, { ignoreNames, minScore: s.minScore, scanDepth: s.scanDepth, maxMemories: s.maxMemories, maxTokens: s.maxTokens, headerTokens });
    const picked = sel.picked.slice();
    let text = buildText(picked);
    let tokens = await countTokens(text);
    let guard = 0;
    const dropped = [];
    while (tokens > s.maxTokens && picked.length && guard++ < 12) {
        // retire d'abord le moins bien classé non épinglé, sinon le dernier épinglé
        let i = -1;
        for (let k = picked.length - 1; k >= 0; k--) if (!picked[k].pinned) { i = k; break; }
        if (i < 0) i = picked.length - 1;
        dropped.push(picked.splice(i, 1)[0]);
        text = buildText(picked);
        tokens = await countTokens(text);
    }
    const warnings = [];
    const budgetSkipped = sel.skipped.filter((x) => x.why === 'budget').length + dropped.length;
    if (sel.pinnedDropped || dropped.some((d) => d.pinned)) warnings.push(`${sel.pinnedDropped + dropped.filter((d) => d.pinned).length} souvenir(s) épinglé(s) non injecté(s) : budget de ${s.maxTokens} tokens dépassé`);
    if (budgetSkipped) warnings.push(`${budgetSkipped} souvenir(s) pertinent(s) ignoré(s) faute de budget (${s.maxTokens} tokens)`);
    if (sel.skipped.some((x) => x.why === 'max')) warnings.push(`${sel.skipped.filter((x) => x.why === 'max').length} souvenir(s) pertinent(s) ignoré(s) : maximum de ${s.maxMemories} souvenirs atteint`);
    if (tokens > s.maxTokens) warnings.push(`Injection (${tokens} tokens) supérieure au budget (${s.maxTokens})`);
    const report = st.scopeReport(scopes);
    for (const p of picked) p.scopeLabel = st.scopeLabel(p.scopeKey);
    return {
        text, picked, skipped: sel.skipped, tokens, budget: s.maxTokens, warnings,
        candidates: items.length, query: texts, at: Date.now(), type,
        speaker: speakerAv || null, speakerName: speakerName(speakerAv), report, why: explain(report, speakerAv, items, picked),
    };
}

/**
 * Diagnostic « Tester l'injection maintenant » : calcule (sans rien envoyer) l'injection exacte pour CHAQUE orateur possible.
 * En groupe : un résultat par membre + un pour « orateur pas encore choisi » ; hors groupe : le perso courant.
 */
export async function testInjection({ override = null } = {}) {
    const g = st.currentGroup();
    const cases = [];
    if (g) {
        cases.push({ av: null, label: 'Avant le choix de l’orateur (moment de GENERATION_STARTED)' });
        for (const av of g.members || []) cases.push({ av, label: speakerName(av) + ((g.disabled_members || []).includes(av) ? ' (muet)' : '') });
    } else cases.push({ av: st.speakerAvatar(), label: speakerName(st.speakerAvatar()) || 'Chat courant' });
    const out = [];
    for (const cs of cases) {
        const r = await buildInjection({ type: 'normal', override, speaker: cs.av });
        out.push({ speaker: cs.av, label: cs.label, tokens: r.tokens, budget: r.budget, count: r.picked.length, candidates: r.candidates, lines: r.picked.map((p) => ({ id: p.m.id, text: p.m.text, pinned: !!p.pinned, scope: p.scopeLabel, tokens: p.tokens })), warnings: r.warnings, why: r.why, text: r.text });
    }
    return out;
}

export function clearInjection() {
    try { ctx().setExtensionPrompt(st.PROMPT_KEY, '', 0, 0, false, 0); } catch { /* ignore */ }
}

/**
 * En groupe, ST émet GENERATION_STARTED une première fois « au niveau du groupe » (orateur inconnu, jamais envoyé au modèle),
 * puis une fois par membre qui répond (après GROUP_MEMBER_DRAFTED). On les distingue pour ne compter que les vraies injections.
 */
export function isTopLevelGroup() {
    const c = ctx();
    if (!c.groupId) return false;
    if (c.eventTypes?.GROUP_MEMBER_DRAFTED) return !state.drafted;
    return c.characterId === undefined;
}
export function onMemberDrafted() { state.drafted = true; }
export function onGroupFinished() { state.drafted = false; }

export async function onGenerationStarted(type, params, dryRun) {
    const s = S();
    try {
        if (!s.enabled || type === 'quiet') { clearInjection(); return; }
        const topLevelGroup = isTopLevelGroup(); // ce passage-là n'est jamais envoyé : la vraie génération est relancée par personnage
        const r = await buildInjection({ type, pending: pendingText(type, params, dryRun), speaker: topLevelGroup ? null : undefined });
        ctx().setExtensionPrompt(st.PROMPT_KEY, r.text, s.position, s.depth, false, s.role);
        if (!dryRun && !topLevelGroup) state.lastInjection = r;
        state.history.push({ type, dry: !!dryRun, tokens: r.tokens, n: r.picked.length, last: r.query[r.query.length - 1]?.slice(0, 40) });
        if (state.history.length > 20) state.history.shift();
        if (!dryRun && !topLevelGroup) {
            const stt = st.rollStats();
            stt.injections++; stt.injectedTokensTotal += r.tokens; stt.lastInjectedTokens = r.tokens;
            st.saveSettings();
            const now = Date.now();
            let chatTouched = false; let storeTouched = false;
            for (const p of r.picked) {
                p.m.lastUsed = now; p.m.uses = (p.m.uses || 0) + 1;
                if (p.scopeKey === 'chat') chatTouched = true; else storeTouched = true;
            }
            if (chatTouched) st.saveChatData();
            if (storeTouched) st.markDirty();
        }
        st.emitChange();
    } catch (e) {
        console.warn(LOG, 'injection impossible', e);
        clearInjection();
    }
}

/* ------------------------------------------------------------------ candidats locaux (heuristique, gratuit) */

function targetScopeFor(msg) {
    const g = st.currentGroup();
    if (g) {
        if (!msg.is_user) {
            const av = msg.original_avatar || st.avatarByName(msg.name);
            if (av) return `char:${av}`;
        }
        return `group:${g.id}`;
    }
    const c = ctx();
    const ch = c.characters[c.characterId];
    return ch ? `char:${ch.avatar}` : null;
}

function toMsgs(from, to) {
    const chat = ctx().chat || [];
    const out = [];
    for (let i = Math.max(0, from); i <= Math.min(to, chat.length - 1); i++) {
        const m = chat[i];
        if (!m || m.is_system || !m.mes) continue;
        out.push({ ...m, idx: i, name: m.name, is_user: !!m.is_user });
    }
    return out;
}

export function scanMessages(from, to, { notify = false } = {}) {
    const s = S();
    const found = core.heuristicExtract(toMsgs(from, to), { minScore: s.heuristicsMinScore });
    let added = 0;
    const chat = ctx().chat || [];
    for (const f of found) {
        const msg = chat[f.idx];
        const scope = targetScopeFor(msg);
        if (!scope) continue;
        if (st.addCandidate({ ...f, scope, origin: 'heuristique', src: { idx: f.idx, chat: ctx().getCurrentChatId?.() ?? null } })) added++;
    }
    if (notify) st.toast(added ? 'success' : 'info', added ? `${added} candidat(s) trouvé(s) (analyse locale, gratuite)` : 'Aucun nouveau candidat trouvé');
    return added;
}

export function initChatCursors() {
    const cd = st.chatData(true);
    if (!cd) return;
    const last = (ctx().chat?.length || 0) - 1;
    let touched = false;
    if (cd.heurIdx === undefined) { cd.heurIdx = last; touched = true; }
    if (cd.lastExtractIdx === undefined) { cd.lastExtractIdx = last; touched = true; }
    if (cd.lastSummaryIdx === undefined || cd.lastSummaryIdx === null) { cd.lastSummaryIdx = -1; touched = true; }
    if (cd.heurIdx > last) cd.heurIdx = last; // messages supprimés
    if (cd.lastExtractIdx > last) cd.lastExtractIdx = last;
    if (touched) st.saveChatData();
}

export function scanNew() {
    if (!S().enabled || !S().heuristics) return 0;
    const cd = st.chatData(true);
    if (!cd) return 0;
    initChatCursors();
    const last = (ctx().chat?.length || 0) - 1;
    const from = Math.max(cd.heurIdx + 1, last - 3);
    const n = last >= from ? scanMessages(from, last) : 0;
    cd.heurIdx = last;
    st.saveChatData();
    return n;
}

/* ------------------------------------------------------------------ appels IA (budget dur) */

async function callAI(kind, { systemPrompt, prompt, responseLength }) {
    const inputTokens = await countTokens(`${systemPrompt}\n${prompt}`);
    const est = inputTokens + responseLength;
    const chk = st.budgetCheck(est);
    if (!chk.ok) {
        st.recordBlocked();
        const day = st.todayKey();
        if (state.capNotifiedDay !== day + chk.reason) { state.capNotifiedDay = day + chk.reason; st.toast('warning', `${kind} non lancée : ${chk.reason}`); }
        return { ok: false, reason: chk.reason };
    }
    if (state.running) return { ok: false, reason: 'Un appel de mémoire est déjà en cours' };
    state.running = true;
    st.emitChange();
    try {
        let raw = '';
        let err = null;
        try {
            raw = await ctx().generateRaw({ prompt, systemPrompt, responseLength });
        } catch (e) { err = e; }
        // generateRaw lève « No message generated » quand la réponse est vide : ce n'est pas une panne d'API, on le traite comme une réponse vide
        if (err && /no message generated/i.test(String(err?.message || err))) { err = null; raw = ''; }
        const out = typeof raw === 'string' ? raw : '';
        const outTokens = await countTokens(out);
        st.recordCall(inputTokens + outTokens);
        if (err) { state.lastAIError = String(err?.message || err); return { ok: false, reason: `Erreur de l’API : ${state.lastAIError}` }; }
        state.lastAIError = '';
        return { ok: true, text: out, inputTokens, outTokens };
    } finally {
        state.running = false;
        st.emitChange();
    }
}

/** Vrai si la réponse ne contient rien d'exploitable (vide, ou uniquement de la « réflexion »). */
function isEmptyAnswer(text) {
    return !core.stripModelNoise(text).trim();
}

/** Prépare l'extraction : derniers messages, tronqués au budget de tokens d'entrée (les plus anciens sont retirés d'abord). */
async function prepareExtraction(manual, { short = false } = {}) {
    const s = S();
    const chat = ctx().chat || [];
    const last = chat.length - 1;
    let n = manual ? Math.max(4, s.extractMessages) : Math.max(2, s.autoEvery);
    if (short) n = Math.max(4, Math.min(12, Math.ceil(n / 3)));
    let msgChars = short ? Math.min(250, s.autoMsgChars) : s.autoMsgChars;
    const budget = Math.max(300, Math.round(s.extractInputTokens * (short ? 0.5 : 1)));
    let msgs = toMsgs(Math.max(0, last - n * 2 - 20), last).slice(-n)
        .map((m) => ({ name: m.name, mes: m.mes, idx: m.idx, is_user: m.is_user, original_avatar: m.original_avatar }));
    const total = msgs.length;
    let p = core.buildExtractionPrompt(msgs, { maxItems: s.autoMaxItems, msgChars });
    let input = await countTokens(`${p.systemPrompt}\n${p.prompt}`);
    for (let i = 0; i < 12 && input > budget && (msgs.length > 2 || msgChars > 100); i++) {
        if (msgs.length > 2) msgs = msgs.slice(-Math.max(2, Math.min(msgs.length - 1, Math.floor(msgs.length * (budget / input) * 0.95))));
        else msgChars = Math.max(100, Math.floor(msgChars / 2));
        p = core.buildExtractionPrompt(msgs, { maxItems: s.autoMaxItems, msgChars });
        input = await countTokens(`${p.systemPrompt}\n${p.prompt}`);
    }
    return { msgs, p, input, dropped: total - msgs.length, msgChars };
}

/** Estimation (sans appel) du coût d'une extraction maintenant. */
export async function estimateExtraction() {
    const prep = await prepareExtraction(true);
    return { input: prep.input, output: S().autoMaxTokens, messages: prep.msgs.length };
}

function emptyExplanation({ retried, messages, maxTokens }) {
    const where = retried ? 'même après un nouvel essai avec un prompt plus court' : 'sans nouvel essai';
    return `Réponse vide de l’IA (${where} : ${messages} message(s) envoyé(s), ${maxTokens} tokens de réponse max). Rien n’a été mémorisé.\n`
        + 'Causes probables :\n'
        + '• Modèle à réflexion (DeepSeek reasoner/R1, o1, Gemini Pro…) : la réflexion consomme tous les tokens et laisse la réponse vide → augmente « Réponse de l’IA : tokens max » (1500 ou plus) ou utilise un modèle sans réflexion (ex. deepseek-chat).\n'
        + '• Contexte trop grand pour le modèle → réduis « Nombre de messages à analyser » (essaie 10 à 20).\n'
        + '• Filtre de contenu du fournisseur (scènes de RP) ou erreur silencieuse du proxy → réessaie avec moins de messages.\n'
        + 'L’analyse locale gratuite (🧮) reste disponible.';
}

/** Extraction groupée par l'IA : UN appel pour les N derniers messages (un seul 2ᵉ essai, plus court, si la réponse est vide). */
export async function runExtraction({ manual = false } = {}) {
    const s = S();
    const cd = st.chatData(true);
    if (!cd) return { ok: false, reason: 'Aucun chat ouvert' };
    if (!s.enabled) return { ok: false, reason: 'Extension désactivée' };
    if (state.running) return { ok: false, reason: 'Un appel de mémoire est déjà en cours' };
    let prep = await prepareExtraction(manual);
    if (!prep.msgs.length) return { ok: false, reason: 'Aucun message à analyser' };
    let maxTokens = s.autoMaxTokens;
    let r = await callAI('Extraction', { ...prep.p, responseLength: maxTokens });
    let retried = false;
    let inTok = r.inputTokens || 0;
    let outTok = r.outTokens || 0;
    if (r.ok && isEmptyAnswer(r.text)) {
        // 2ᵉ essai unique : prompt plus court + plus de place pour la réponse (un modèle à réflexion en a besoin)
        retried = true;
        prep = await prepareExtraction(manual, { short: true });
        maxTokens = Math.max(800, Math.min(2000, s.autoMaxTokens * 4));
        console.warn(LOG, 'Réponse vide, nouvel essai avec', prep.msgs.length, 'message(s) et', maxTokens, 'tokens max');
        const r2 = await callAI('Extraction (2ᵉ essai)', { ...prep.p, responseLength: maxTokens });
        if (!r2.ok) {
            const why = String(r2.reason || '');
            return { ok: false, empty: true, reason: `Réponse vide de l’IA ; nouvel essai impossible : ${why}`, detail: `${emptyExplanation({ retried: false, messages: prep.msgs.length, maxTokens })}\nNouvel essai non effectué : ${why}` };
        }
        r = r2;
        inTok += r2.inputTokens || 0;
        outTok += r2.outTokens || 0;
    }
    if (!r.ok) return r;
    if (isEmptyAnswer(r.text)) {
        if (!manual) { cd.lastExtractIdx = (ctx().chat?.length || 1) - 1; st.saveChatData(); } // auto : pas de boucle d'appels
        return { ok: false, empty: true, retried, reason: 'Réponse vide de l’IA (voir les causes probables ci-dessous)', detail: emptyExplanation({ retried, messages: prep.msgs.length, maxTokens }) };
    }
    const msgs = prep.msgs;
    cd.lastExtractIdx = (ctx().chat?.length || 1) - 1; // avancé même si 0 résultat : jamais de ré-essai automatique
    st.saveChatData();
    const items = core.parseExtraction(r.text, s.autoMaxItems);
    const lastMsg = msgs[msgs.length - 1];
    const g = st.currentGroup();
    const scope = g ? `group:${g.id}` : targetScopeFor({ is_user: false, name: ctx().name2, original_avatar: lastMsg.original_avatar });
    let added = 0;
    for (const it of items) {
        const src = { idx: lastMsg.idx, chat: ctx().getCurrentChatId?.() ?? null };
        if (s.autoToInbox) { if (st.addCandidate({ ...it, scope, origin: 'ia', src })) added++; }
        else if (st.addMemory(scope, { ...it, src }, { allowDuplicate: false }).entry) added++;
    }
    return { ok: true, added, found: items.length, retried, messages: msgs.length, inputTokens: inTok, outTokens: outTok, raw: r.text };
}

/** Résumé glissant : UN souvenir « résumé » par chat, mis à jour rarement. */
export async function runSummary({ manual = false } = {}) {
    const s = S();
    const cd = st.chatData(true);
    if (!cd) return { ok: false, reason: 'Aucun chat ouvert' };
    if (state.running) return { ok: false, reason: 'Un appel de mémoire est déjà en cours' };
    const last = (ctx().chat?.length || 1) - 1;
    const from = Math.max(cd.lastSummaryIdx + 1, last - 60);
    const msgs = toMsgs(from, last);
    if (!msgs.length) return { ok: false, reason: 'Rien de nouveau à résumer' };
    const mem = cd.memories.find((m) => m.summary);
    const p = core.buildSummaryPrompt(mem?.text || '', msgs, { maxWords: Math.round(s.summaryMaxTokens / 1.6) });
    const r = await callAI('Résumé', { ...p, responseLength: s.summaryMaxTokens });
    if (!r.ok) return r;
    const text = core.cleanText(r.text).slice(0, 600);
    cd.lastSummaryIdx = last;
    if (!text) { st.saveChatData(); return { ok: false, empty: true, reason: 'Réponse vide de l’IA', detail: 'Réponse vide de l’IA. Causes probables : modèle à réflexion (augmente « Taille max du résumé » à 1000), ou contexte/filtre du fournisseur. Rien n’a été modifié.' }; }
    if (mem) { mem.text = text; mem.lastUsed = mem.lastUsed; }
    else cd.memories.push(core.makeMemory({ text, type: 'resume', importance: 5, pinned: true, summary: true, keywords: [] }, new Set()));
    st.saveChatData();
    st.emitChange();
    return { ok: true, text, inputTokens: r.inputTokens, outTokens: r.outTokens };
}

let autoTimer = null;
let autoTries = 0;
export function scheduleAuto() {
    const s = S();
    if (!s.enabled || s.neverAI || (!s.autoExtract && !s.autoSummary)) return;
    clearTimeout(autoTimer);
    autoTries = 0;
    autoTimer = setTimeout(autoTick, 1500);
}

function isBusy() {
    const stop = document.getElementById('stop_but');
    return !!(stop && stop.offsetParent !== null) || state.running;
}

async function autoTick() {
    const s = S();
    if (isBusy()) { if (autoTries++ < 20) autoTimer = setTimeout(autoTick, 1500); return; }
    const cd = st.chatData(false);
    if (!cd) return;
    const last = (ctx().chat?.length || 1) - 1;
    try {
        if (s.autoExtract && !s.neverAI && last - (cd.lastExtractIdx ?? last) >= s.autoEvery) {
            const r = await runExtraction({ manual: false });
            if (r.ok) st.toast('info', `Mémoire : ${r.added} candidat(s) ajouté(s) par l’IA (${r.inputTokens + r.outTokens} tokens)`);
            else if (r.empty) st.toast('warning', `Mémoire : ${r.reason}. Ouvre l’onglet Candidats pour les causes probables.`);
        }
        if (s.autoSummary && !s.neverAI && last - (cd.lastSummaryIdx ?? -1) >= s.summaryEvery) {
            const r = await runSummary({ manual: false });
            if (r.ok) st.toast('info', 'Mémoire : résumé mis à jour');
        }
    } catch (e) { console.warn(LOG, e); }
}

/* ------------------------------------------------------------------ entretien */

export function runArchive({ force = false } = {}) {
    const s = S();
    const day = st.todayKey();
    if (!force && s.lastArchiveDay === day) return 0;
    const limit = Date.now() - s.archiveDays * 86400000;
    let n = 0;
    const touchedChat = [];
    for (const { key, m } of st.allEntries()) {
        if (m.pinned || m.archived || m.summary || m.importance > 2) continue;
        const ref = Math.max(m.created || 0, m.lastUsed || 0);
        if (ref && ref < limit) { m.archived = true; n++; if (key === 'chat') touchedChat.push(m); }
    }
    s.lastArchiveDay = day;
    st.saveSettings();
    if (n) { st.markDirty(); st.saveChatData(); st.emitChange(); }
    return n;
}

export function duplicatesIn(key) {
    return core.findDuplicates(st.getList(key, false).filter((m) => !m.archived), S().dedupThreshold);
}

export function mergeDuplicate(key, idA, idB) {
    const list = st.getList(key, false);
    const a = list.find((m) => m.id === idA);
    const b = list.find((m) => m.id === idB);
    if (!a || !b) return false;
    core.mergeInto(a, b);
    st.deleteMemory(key, idB);
    st.updateMemory(key, idA, {});
    return true;
}
