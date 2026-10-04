/**
 * Mémoire Permanente — extension SillyTavern
 * Mémoire à long terme (par personnage / persona / groupe / monde / chat), conservée entre les chats,
 * injectée en petite quantité et sélectionnée LOCALEMENT (zéro appel API par défaut).
 *
 * Vanilla ES modules, aucune étape de build. Aucune importation de SillyTavern : tout passe par
 * SillyTavern.getContext(), donc compatible avec les versions >= 1.12.
 */
import * as core from './core.js';
import * as st from './store.js';
import * as eng from './engine.js';
import * as ui from './ui.js';

const { ctx, S, LOG } = st;
let started = false;

/* ------------------------------------------------------------------ commande /mem */

function resolveScope(name) {
    const v = core.normalize(name || '').trim();
    const scopes = st.viewerScopes();
    if (!v) return null;
    if (['chat', 'discussion'].includes(v)) return scopes.find((x) => x.kind === 'chat')?.key || null;
    if (['monde', 'world', 'global'].includes(v)) return 'world';
    if (['persona', 'moi', 'user'].includes(v)) return scopes.find((x) => x.kind === 'persona')?.key || null;
    if (['groupe', 'group'].includes(v)) return scopes.find((x) => x.kind === 'group')?.key || null;
    if (['perso', 'personnage', 'char', 'character'].includes(v)) return scopes.find((x) => x.kind === 'char')?.key || null;
    return scopes.find((x) => x.kind === 'char' && core.normalize(x.name) === v)?.key || null;
}

function defaultScope() {
    const scopes = st.viewerScopes();
    return (st.currentGroup() ? scopes.find((x) => x.kind === 'group') : scopes.find((x) => x.kind === 'char'))?.key || 'world';
}

function line(key, m) {
    return `${m.pinned ? '📌' : '•'} [${m.id}] (${core.TYPES[m.type] || m.type}, ★${m.importance}${m.enabled ? '' : ', off'}${m.archived ? ', archivé' : ''}) ${m.text}`;
}

/** Les arguments nommés écrits APRÈS la sous-commande (`/mem add scope=monde imp=4 texte`) ne sont pas lus par ST : on les lit ici. */
function inlineArgs(text) {
    const args = {};
    let rest = String(text || '').trim();
    for (;;) {
        const m = rest.match(/^(scope|type|imp|importance|pin|pinned|tags|keywords)=(?:"([^"]*)"|(\S+))\s*/i);
        if (!m) break;
        args[m[1].toLowerCase()] = m[2] ?? m[3];
        rest = rest.slice(m[0].length);
    }
    return { args, rest: rest.trim() };
}

async function memCommand(named0, unnamed) {
    const raw = String(Array.isArray(unnamed) ? unnamed.join(' ') : (unnamed ?? '')).trim();
    const m = raw.match(/^(\S+)\s*([\s\S]*)$/);
    const sub = core.normalize(m ? m[1] : 'ouvrir');
    const inl = inlineArgs(m ? m[2] : '');
    const named = { ...(named0 || {}), ...inl.args };
    const rest = inl.rest;
    switch (sub) {
        case 'add': case 'ajouter': case 'ajoute': {
            if (!rest) { st.toast('warning', 'Usage : /mem add <texte>'); return ''; }
            const key = named.scope ? resolveScope(named.scope) : defaultScope();
            if (!key) { st.toast('warning', `Portée inconnue : ${named.scope}`); return ''; }
            const r = st.addMemory(key, { text: rest, type: named.type || 'fait', importance: named.imp || named.importance || 3, pinned: String(named.pin ?? named.pinned) === 'true', keywords: named.tags || named.keywords || '' });
            st.toast('success', `Souvenir ajouté [${r.entry?.id}] (${st.scopeLabel(key)})`);
            return r.entry?.id || '';
        }
        case 'list': case 'liste': case 'ls': {
            const keys = st.viewerScopes().map((x) => x.key);
            const out = [];
            for (const k of keys) for (const mem of st.getList(k, false)) out.push(`${st.scopeLabel(k)} ${line(k, mem)}`);
            ui.openSheet('mem');
            return out.join('\n') || '(aucun souvenir)';
        }
        case 'forget': case 'oublie': case 'oublier': case 'del': case 'delete': {
            const f = st.findMemory(rest);
            if (!f) { st.toast('warning', `Souvenir introuvable : ${rest}`); return ''; }
            st.deleteMemory(f.key, f.m.id);
            st.toast('info', `Oublié : ${f.m.text.slice(0, 50)}`);
            return f.m.id;
        }
        case 'pin': case 'epingle': case 'unpin': {
            const f = st.findMemory(rest);
            if (!f) { st.toast('warning', `Souvenir introuvable : ${rest}`); return ''; }
            const to = sub === 'unpin' ? false : !f.m.pinned;
            st.updateMemory(f.key, f.m.id, { pinned: to });
            st.toast('info', to ? 'Épinglé 📌' : 'Désépinglé');
            return f.m.id;
        }
        case 'scan': {
            const last = (ctx().chat?.length || 1) - 1;
            return String(eng.scanMessages(last - 40, last, { notify: true }));
        }
        case 'stats': {
            const t = st.rollStats();
            return `Injection : ${t.lastInjectedTokens} tokens · appels IA aujourd'hui ${t.callsToday}/${S().maxCallsPerDay} · tokens mois ≈ ${t.tokensMonth}`;
        }
        case 'open': case 'ouvrir': case 'ouvre': default:
            ui.openSheet('mem');
            return '';
    }
}

function registerSlash() {
    try {
        const c = ctx();
        const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = c;
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mem',
            aliases: ['memoire'],
            callback: memCommand,
            namedArgumentList: [
                SlashCommandNamedArgument.fromProps({ name: 'scope', description: 'portée : perso, chat, monde, persona, groupe ou nom d’un personnage', typeList: [ARGUMENT_TYPE.STRING], defaultValue: '' }),
                SlashCommandNamedArgument.fromProps({ name: 'type', description: 'fait, relation, evenement, preference, lieu, objectif', typeList: [ARGUMENT_TYPE.STRING], defaultValue: 'fait' }),
                SlashCommandNamedArgument.fromProps({ name: 'imp', description: 'importance 1 à 5', typeList: [ARGUMENT_TYPE.NUMBER], defaultValue: '3' }),
                SlashCommandNamedArgument.fromProps({ name: 'pin', description: 'épingler (true/false)', typeList: [ARGUMENT_TYPE.BOOLEAN], defaultValue: 'false' }),
                SlashCommandNamedArgument.fromProps({ name: 'tags', description: 'mots-clés séparés par des virgules', typeList: [ARGUMENT_TYPE.STRING], defaultValue: '' }),
            ],
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'add <texte> | list | forget <id> | pin <id> | unpin <id> | scan | stats | open', typeList: [ARGUMENT_TYPE.STRING], isRequired: false })],
            helpString: '<div><b>Mémoire Permanente</b><ul><li><code>/mem add Léa déteste les araignées</code></li><li><code>/mem add scope=monde type=lieu imp=4 Valmont est en guerre</code> (scope : perso, chat, monde, persona, groupe ou nom d’un perso)</li><li><code>/mem list</code></li><li><code>/mem forget &lt;id&gt;</code></li><li><code>/mem pin &lt;id&gt;</code></li><li><code>/mem scan</code> (analyse locale gratuite)</li><li><code>/mem</code> ouvre le panneau</li></ul></div>',
            returns: 'texte',
        }));
    } catch (e) { console.warn(LOG, 'commande /mem indisponible', e); }
}

/* ------------------------------------------------------------------ démarrage */

async function start() {
    if (started) return;
    started = true;
    const c = ctx();
    S(); // crée / migre les réglages
    try {
        const personas = await import('../../../personas.js');
        st.setUserAvatarGetter(() => personas.user_avatar);
    } catch (e) { console.warn(LOG, 'persona indisponible', e); }
    await st.loadStore();
    ui.initUI();
    registerSlash();

    const ev = c.eventSource;
    const T = c.eventTypes;
    const onChat = () => {
        try { eng.initChatCursors(); } catch (e) { console.warn(LOG, e); }
        eng.clearInjection();
        ui.refreshAll();
        setTimeout(() => ui.decorateMessages(), 300);
        if (S().autoArchive) eng.runArchive();
    };
    ev.on(T.CHAT_CHANGED, onChat);
    ev.on(T.GENERATION_STARTED, (type, params, dry) => eng.onGenerationStarted(type, params, dry));
    const onMsg = () => {
        try { const n = eng.scanNew(); if (n) st.toast('info', `🧠 ${n} souvenir(s) candidat(s) détecté(s)`, { timeOut: 2500 }); } catch (e) { console.warn(LOG, e); }
        eng.scheduleAuto();
        ui.decorateMessages();
        ui.renderSoon();
    };
    ev.on(T.MESSAGE_RECEIVED, onMsg);
    ev.on(T.MESSAGE_SENT, () => { try { eng.scanNew(); } catch (e) { console.warn(LOG, e); } ui.renderSoon(); });
    for (const name of ['GROUP_WRAPPER_FINISHED']) if (T[name]) ev.on(T[name], () => eng.scheduleAuto());
    for (const name of ['USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED']) {
        if (T[name]) ev.on(T[name], () => { ui.decorateMessages(); });
    }
    if (T.GROUP_UPDATED) ev.on(T.GROUP_UPDATED, () => ui.renderSoon());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && st.storeStatus.dirty) st.saveStoreNow(); });
    window.addEventListener('pagehide', () => { if (st.storeStatus.dirty) st.saveStoreNow(); });

    globalThis.permanentMemory = { core, store: st, engine: eng, ui, settings: S, ready: true };
    onChat();
    console.log(LOG, 'prête');
}

function boot() {
    const c = globalThis.SillyTavern?.getContext?.();
    if (!c) { setTimeout(boot, 300); return; }
    const go = () => start().catch((e) => console.error(LOG, 'démarrage impossible', e));
    // jQuery(go) = après le chargement du DOM ; l'extension est de toute façon chargée après APP_READY dans ST récent
    if (document.getElementById('extensions_settings2')) go();
    else c.eventSource.on(c.eventTypes.APP_READY, go);
}
boot();
