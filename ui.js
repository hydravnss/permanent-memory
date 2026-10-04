/**
 * Mémoire Permanente — interface (iPhone first) : panneau plein écran, éditeur, réglages,
 * bouton flottant, entrée du menu baguette, bouton « Mémoriser » sur les messages.
 * Aucun `transform` sur un ancêtre : tout est en position:fixed sous <body>.
 */
import * as core from './core.js';
import * as st from './store.js';
import * as eng from './engine.js';

const { ctx, S } = st;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');

const ui = { open: false, tab: 'mem', scope: '__cur', q: '', type: '', status: 'actifs', sim: '', dupPairs: null, armed: null, lastResult: '' };

/* ------------------------------------------------------------------ réglages (liste de champs) */

const FIELDS = [
    { sec: 'Général' },
    { key: 'enabled', type: 'check', label: 'Activer la mémoire permanente' },
    { key: 'preset', type: 'select', label: 'Préréglage', options: Object.entries(st.PRESETS).map(([k, v]) => [k, v.label]), preset: true },
    { sec: 'Injection dans le prompt (100 % local, 0 crédit)' },
    { key: 'maxMemories', type: 'num', label: 'Souvenirs max par message', min: 1, max: 30 },
    { key: 'maxTokens', type: 'num', label: 'Budget max (tokens)', min: 50, max: 3000, step: 50 },
    { key: 'scanDepth', type: 'num', label: 'Messages récents analysés', min: 1, max: 10 },
    { key: 'minScore', type: 'num', label: 'Sensibilité (score min. ; plus haut = plus strict)', min: 0.1, max: 5, step: 0.1 },
    { key: 'position', type: 'select', label: 'Position', options: [[1, 'Dans le chat (profondeur) — conseillé, garde le cache'], [0, 'Après le prompt système'], [2, 'Avant le prompt système']] },
    { key: 'depth', type: 'num', label: 'Profondeur (si « dans le chat »)', min: 0, max: 50 },
    { key: 'role', type: 'select', label: 'Rôle du message', options: [[0, 'Système'], [1, 'Utilisateur'], [2, 'Assistant']] },
    { key: 'header', type: 'text', label: 'Début du bloc injecté ({{char}} accepté)' },
    { key: 'includeChat', type: 'check', label: 'Inclure les souvenirs propres au chat' },
    { key: 'useWorld', type: 'check', label: 'Inclure les souvenirs « Monde » (partagés)' },
    { key: 'usePersona', type: 'check', label: 'Inclure les souvenirs du persona' },
    { key: 'groupAllMembers', type: 'check', label: 'Groupes : injecter les souvenirs de tous les membres du groupe (+ groupe + monde). Décoché : seulement le perso qui parle.' },
    { key: 'groupIncludeMuted', type: 'check', label: 'Groupes : inclure aussi les membres « muets »' },
    { sec: 'Création des souvenirs' },
    { key: 'heuristics', type: 'check', label: 'Détecter des candidats en local (gratuit)' },
    { key: 'heuristicsMinScore', type: 'num', label: 'Exigence de la détection locale (1 = large, 4 = strict)', min: 1, max: 6 },
    { key: 'messageButton', type: 'check', label: 'Bouton 🧠 « Mémoriser » sur chaque message' },
    { sec: 'IA (optionnel — coûte des crédits)' },
    { key: 'neverAI', type: 'check', label: '🚫 Ne jamais appeler l’IA (100 % local, aucune requête)', strong: true },
    { key: 'autoExtract', type: 'check', label: 'Extraction automatique toutes les N messages' },
    { key: 'autoEvery', type: 'num', label: 'N = intervalle (messages)', min: 2, max: 100 },
    { key: 'autoMaxItems', type: 'num', label: 'Faits max par extraction', min: 1, max: 10 },
    { key: 'autoMaxTokens', type: 'num', label: 'Réponse de l’IA : tokens max', min: 50, max: 1000, step: 10 },
    { key: 'autoToInbox', type: 'check', label: 'Envoyer dans la boîte « Candidats » (sinon ajout direct)' },
    { key: 'maxCallsPerDay', type: 'num', label: 'Plafond d’appels par jour (0 = bloqué)', min: 0, max: 100 },
    { key: 'maxTokensPerMonth', type: 'num', label: 'Plafond de tokens par mois, estimé (0 = bloqué)', min: 0, max: 5000000, step: 1000 },
    { key: 'autoSummary', type: 'check', label: 'Résumé glissant automatique' },
    { key: 'summaryEvery', type: 'num', label: 'Mettre à jour le résumé tous les… messages', min: 10, max: 500 },
    { key: 'summaryMaxTokens', type: 'num', label: 'Taille max du résumé (tokens)', min: 50, max: 1000, step: 10 },
    { sec: 'Entretien' },
    { key: 'dedupThreshold', type: 'num', label: 'Seuil de doublon (Jaccard, 0.3–1)', min: 0.3, max: 1, step: 0.05 },
    { key: 'autoArchive', type: 'check', label: 'Archiver auto. les souvenirs peu importants et inutilisés (jamais supprimés)' },
    { key: 'archiveDays', type: 'num', label: 'Archiver après (jours)', min: 7, max: 730 },
    { sec: 'Accès rapide' },
    { key: 'wand', type: 'check', label: 'Entrée « 🧠 Mémoire » dans le menu baguette' },
    { key: 'floating', type: 'check', label: 'Petit bouton flottant 🧠' },
    { key: 'floatSize', type: 'range', label: 'Taille du bouton', min: 34, max: 90 },
    { key: 'floatX', type: 'range', label: 'Position horizontale (%)', min: 0, max: 100 },
    { key: 'floatY', type: 'range', label: 'Position verticale (%)', min: 0, max: 100 },
];

function settingsHtml() {
    let h = `<div id="pmem_settings" class="pmem-settings"><div class="inline-drawer">
<div class="inline-drawer-toggle inline-drawer-header"><b>🧠 Mémoire Permanente</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
<div class="inline-drawer-content">
<div id="pmem_status" class="pmem-status"></div>
<div class="pmem-row-btns">
<button type="button" class="menu_button" id="pmem_open">🧠 Ouvrir la mémoire</button>
<button type="button" class="menu_button" id="pmem_eco">💰 Mode économie</button>
<button type="button" class="menu_button" id="pmem_move">↔️ Déplacer le bouton</button>
</div>`;
    let inSec = false;
    for (const f of FIELDS) {
        if (f.sec) { if (inSec) h += '</div>'; h += `<div class="pmem-sec"><h4>${esc(f.sec)}</h4>`; inSec = true; continue; }
        const id = `pmem_f_${f.key}`;
        if (f.type === 'check') h += `<label class="checkbox_label pmem-field${f.strong ? ' pmem-strong' : ''}" for="${id}"><input type="checkbox" id="${id}" data-key="${f.key}"><span>${esc(f.label)}</span></label>`;
        else if (f.type === 'select') h += `<label class="pmem-field" for="${id}"><span>${esc(f.label)}</span><select id="${id}" class="text_pole" data-key="${f.key}"${f.preset ? ' data-preset="1"' : ''}>${f.options.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>`;
        else if (f.type === 'range') h += `<label class="pmem-field" for="${id}"><span>${esc(f.label)} : <b id="${id}_v"></b></span><input type="range" id="${id}" data-key="${f.key}" min="${f.min}" max="${f.max}" step="1"></label>`;
        else if (f.type === 'text') h += `<label class="pmem-field" for="${id}"><span>${esc(f.label)}</span><input type="text" class="text_pole" id="${id}" data-key="${f.key}"></label>`;
        else h += `<label class="pmem-field" for="${id}"><span>${esc(f.label)}</span><input type="number" class="text_pole" id="${id}" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step || 1}" inputmode="decimal"></label>`;
    }
    if (inSec) h += '</div>';
    h += '</div></div></div>';
    return h;
}

function syncControls() {
    const s = S();
    for (const f of FIELDS) {
        if (!f.key) continue;
        const el = document.getElementById(`pmem_f_${f.key}`);
        if (!el || document.activeElement === el) continue;
        if (f.type === 'check') el.checked = !!s[f.key];
        else el.value = String(s[f.key]);
        if (f.type === 'range') { const v = document.getElementById(`pmem_f_${f.key}_v`); if (v) v.textContent = String(s[f.key]); }
    }
    const status = $('#pmem_status');
    if (status) {
        const stt = st.rollStats();
        const nCand = pendingCount();
        status.innerHTML = `Dernière injection : <b>${fmtNum(stt.lastInjectedTokens)}</b> tokens (budget ${fmtNum(s.maxTokens)}) · appels IA aujourd’hui : <b>${stt.callsToday}/${s.maxCallsPerDay}</b> · ${s.neverAI ? '🚫 IA désactivée' : (s.autoExtract ? '🤖 auto activé' : '✋ IA manuelle seulement')}${nCand ? ` · 📥 ${nCand} candidat(s)` : ''}`;
    }
    $('#pmem_move')?.classList.toggle('pmem-active', moveMode);
}

function bindSettings() {
    const root = $('#pmem_settings');
    root.addEventListener('input', (e) => {
        const el = e.target.closest('[data-key]');
        if (!el) return;
        const f = FIELDS.find((x) => x.key === el.dataset.key);
        const s = S();
        if (f.type === 'check') s[f.key] = el.checked;
        else if (f.type === 'num' || f.type === 'range') {
            const n = Number(el.value);
            if (el.value === '' || !Number.isFinite(n)) return;
            s[f.key] = n;
        } else if (f.type === 'select') s[f.key] = ['position', 'role'].includes(f.key) ? Number(el.value) : el.value;
        else s[f.key] = el.value;
        if (f.preset) { st.applyPreset(el.value); }
        else if (!['wand', 'floating', 'floatSize', 'floatX', 'floatY', 'enabled', 'header', 'messageButton'].includes(f.key)) s.preset = 'custom';
        S(); // re-clamp
        st.saveSettings();
        if (['wand', 'floating', 'floatSize', 'floatX', 'floatY', 'enabled', 'messageButton'].includes(f.key)) refreshAll();
        if (f.type === 'range') { const v = document.getElementById(`pmem_f_${f.key}_v`); if (v) v.textContent = String(s[f.key]); }
        if (f.preset) syncControls();
        st.emitChange();
    });
    root.addEventListener('change', (e) => { if (e.target.closest('[data-key]')) { syncControls(); } });
    $('#pmem_open').addEventListener('click', () => openSheet('mem'));
    $('#pmem_eco').addEventListener('click', () => { st.applyPreset('economie'); S().neverAI = false; st.saveSettings(); st.toast('success', 'Mode économie : 4 souvenirs, 200 tokens, aucun appel automatique'); syncControls(); });
    $('#pmem_move').addEventListener('click', () => setMoveMode(!moveMode));
}

/* ------------------------------------------------------------------ helpers de données */

function pendingCount() {
    const keys = st.viewerScopes().map((x) => x.key);
    return st.candidatesFor(keys).length;
}

function scopeOptions(selected, { includeAll = false } = {}) {
    const cur = st.viewerScopes();
    const curKeys = new Set(cur.map((x) => x.key));
    let h = '';
    if (includeAll) h += `<option value="__cur"${selected === '__cur' ? ' selected' : ''}>Tout (ce contexte)</option>`;
    for (const sc of cur) h += `<option value="${esc(sc.key)}"${selected === sc.key ? ' selected' : ''}>${esc(sc.label)} (${st.getList(sc.key, false).length})</option>`;
    const others = Object.entries(st.store.scopes).filter(([k]) => !curKeys.has(k) && st.store.scopes[k].memories.length);
    if (others.length) {
        h += '<optgroup label="Autres (sauvegardés)">';
        for (const [k, sc] of others) h += `<option value="${esc(k)}"${selected === k ? ' selected' : ''}>${esc(st.scopeLabel(k))} (${sc.memories.length})</option>`;
        h += '</optgroup>';
    }
    return h;
}

function entriesForView() {
    let keys;
    if (ui.scope === '__cur') keys = st.viewerScopes().map((x) => x.key);
    else keys = [ui.scope];
    const q = core.normalize(ui.q).trim();
    const out = [];
    for (const key of keys) {
        for (const m of st.getList(key, false)) {
            if (ui.type && m.type !== ui.type) continue;
            if (ui.status === 'actifs' && (m.archived || !m.enabled)) continue;
            if (ui.status === 'archives' && !m.archived) continue;
            if (ui.status === 'desactives' && m.enabled) continue;
            if (ui.status === 'epingles' && !m.pinned) continue;
            if (q && !core.normalize(`${m.text} ${(m.keywords || []).join(' ')} ${m.type}`).includes(q)) continue;
            out.push({ key, m });
        }
    }
    out.sort((a, b) => (b.m.pinned - a.m.pinned) || (b.m.importance - a.m.importance) || (b.m.created - a.m.created));
    return out;
}

const stars = (n, attrs = '') => [1, 2, 3, 4, 5].map((i) => `<button type="button" class="pmem-star${i <= n ? ' on' : ''}" data-act="star" data-n="${i}" ${attrs} aria-label="Importance ${i}">★</button>`).join('');
const typeOptions = (sel, withAll = false) => (withAll ? `<option value="">Tous les types</option>` : '') + Object.entries(core.TYPES).filter(([k]) => withAll || k !== 'resume').map(([k, v]) => `<option value="${k}"${sel === k ? ' selected' : ''}>${core.TYPE_ICONS[k]} ${esc(v)}</option>`).join('');

/* ------------------------------------------------------------------ panneau plein écran */

function ensureSheet() {
    let el = $('#pmem-sheet');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'pmem-sheet';
    el.innerHTML = `<div class="pmem-panel" role="dialog" aria-label="Mémoire Permanente">
<div class="pmem-head"><b>🧠 Mémoire Permanente</b><span class="pmem-sub" id="pmem-sub"></span><button type="button" class="pmem-x" data-act="close" aria-label="Fermer">✕</button></div>
<div class="pmem-tabs" id="pmem-tabs">
<button type="button" data-tab="mem">Souvenirs</button><button type="button" data-tab="cand">Candidats</button><button type="button" data-tab="inj">Injection</button><button type="button" data-tab="cost">Coût</button><button type="button" data-tab="tools">Outils</button>
</div>
<div class="pmem-body" id="pmem-body"></div>
</div>`;
    document.body.appendChild(el);
    el.addEventListener('click', onSheetClick);
    el.addEventListener('input', onSheetInput);
    el.addEventListener('change', onSheetInput);
    return el;
}

export function openSheet(tab) {
    const el = ensureSheet();
    if (tab) ui.tab = tab;
    ui.open = true;
    el.classList.add('pmem-open');
    document.body.classList.add('pmem-lock');
    renderSheet();
}
export function closeSheet() {
    ui.open = false;
    $('#pmem-sheet')?.classList.remove('pmem-open');
    document.body.classList.remove('pmem-lock');
}

let renderQueued = false;
export function renderSoon() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; if (ui.open) renderSheet(); syncControls(); updateFloat(); });
}

function keepFocusRender(fn) {
    const body = $('#pmem-body');
    const top = body.scrollTop;
    const act = document.activeElement;
    const id = act?.id;
    const sel = act && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd] : null;
    fn();
    body.scrollTop = top;
    if (id) { const n = document.getElementById(id); if (n) { n.focus(); if (sel && n.setSelectionRange) try { n.setSelectionRange(...sel); } catch { /* ignore */ } } }
}

function renderSheet() {
    const sheet = ensureSheet();
    $$('#pmem-tabs button', sheet).forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
    const nCand = pendingCount();
    const tabC = $('#pmem-tabs [data-tab="cand"]', sheet);
    tabC.innerHTML = `Candidats${nCand ? ` <span class="pmem-badge">${nCand}</span>` : ''}`;
    const c = ctx();
    $('#pmem-sub', sheet).textContent = c.groupId ? `Groupe : ${st.currentGroup()?.name || ''}` : (c.characterId !== undefined ? c.characters[c.characterId]?.name || '' : 'Aucun chat ouvert');
    keepFocusRender(() => {
        const body = $('#pmem-body', sheet);
        if (ui.tab === 'mem') body.innerHTML = renderMem();
        else if (ui.tab === 'cand') body.innerHTML = renderCand();
        else if (ui.tab === 'inj') { body.innerHTML = renderInj(); loadInjPreview(); }
        else if (ui.tab === 'cost') body.innerHTML = renderCost();
        else body.innerHTML = renderTools();
    });
}

/* ---- onglet Souvenirs */

/** Portées proposées dans « Attribuer à » : tout le groupe d'abord, puis les persos, le chat, le persona, le monde. */
function attribScopes() {
    const cur = st.viewerScopes();
    const rank = { group: 0, char: 1, chat: 2, persona: 3, world: 4 };
    return cur.slice().sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));
}
function activeKeySet() {
    try { return new Set(st.activeScopes(st.currentGroup() ? null : undefined).map((x) => x.key)); } catch { return new Set(); }
}
function attribOptions(selected) {
    const sc = attribScopes();
    const keys = new Set(sc.map((x) => x.key));
    let h = sc.map((x) => `<option value="${esc(x.key)}"${x.key === selected ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
    if (selected && !keys.has(selected)) h += `<option value="${esc(selected)}" selected>${esc(st.scopeLabel(selected))} (hors contexte)</option>`;
    return h;
}

function memCard(key, m, multi, activeKeys = new Set()) {
    const inactive = !activeKeys.has(key);
    return `<div class="pmem-card${m.enabled ? '' : ' off'}${m.archived ? ' arch' : ''}${m.pinned ? ' pin' : ''}" data-key="${esc(key)}" data-id="${m.id}">
<div class="pmem-card-top"><span class="pmem-type">${core.TYPE_ICONS[m.type] || ''} ${esc(core.TYPES[m.type] || m.type)}</span>
<span class="pmem-stars">${stars(m.importance, `data-key="${esc(key)}" data-id="${m.id}"`)}</span></div>
<div class="pmem-text" data-act="edit">${esc(m.text)}</div>
<div class="pmem-meta"><span class="pmem-scope${inactive ? ' off' : ''}" title="Attribué à">${esc(st.scopeLabel(key))}</span>${inactive ? ' <span class="pmem-warn-inline">⚠️ non injecté ici</span>' : ''} · <span>${m.id}</span> · utilisé ${m.uses || 0}× · ${fmtDate(m.created)}${m.keywords?.length ? ` · 🏷 ${esc(m.keywords.join(', '))}` : ''}${m.archived ? ' · 🗄 archivé' : ''}</div>
<div class="pmem-actions">
<button type="button" data-act="pin" class="${m.pinned ? 'on' : ''}" title="Épingler (toujours injecté)">${m.pinned ? '📌 Épinglé' : '📍 Épingler'}</button>
<button type="button" data-act="toggle" class="${m.enabled ? '' : 'on'}">${m.enabled ? '⏸ Désactiver' : '▶️ Activer'}</button>
<button type="button" data-act="archive">${m.archived ? '↩️ Restaurer' : '🗄 Archiver'}</button>
<button type="button" data-act="edit">✎ Modifier</button>
<button type="button" data-act="del" class="danger">🗑</button>
<label class="pmem-assign">Attribuer à <select class="text_pole pmem-reassign" data-key="${esc(key)}" data-id="${m.id}">${attribOptions(key)}</select></label>
</div></div>`;
}

function renderMem() {
    const entries = entriesForView();
    const multi = ui.scope === '__cur' && st.viewerScopes().length > 1;
    const total = entries.length;
    return `<div class="pmem-filters">
<select id="pmem-scope" class="text_pole">${scopeOptions(ui.scope, { includeAll: true })}</select>
<input id="pmem-q" class="text_pole" type="search" placeholder="🔎 Rechercher…" value="${esc(ui.q)}">
<select id="pmem-ftype" class="text_pole">${typeOptions(ui.type, true)}</select>
<select id="pmem-fstatus" class="text_pole">${[['actifs', 'Actifs'], ['epingles', 'Épinglés'], ['desactives', 'Désactivés'], ['archives', 'Archivés'], ['tous', 'Tous']].map(([v, t]) => `<option value="${v}"${ui.status === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
</div>
<div class="pmem-bar"><button type="button" class="menu_button" data-act="new">➕ Ajouter</button><span class="pmem-count">${total} souvenir(s)</span></div>
${total ? (() => { const ak = activeKeySet(); return entries.map(({ key, m }) => memCard(key, m, multi, ak)).join(''); })() : '<div class="pmem-empty">Aucun souvenir ici.<br>Ajoute-en avec ➕, le bouton 🧠 sur un message, ou <code>/mem add …</code>.</div>'}`;
}

/* ---- onglet Candidats */

function renderCand() {
    const keys = st.viewerScopes().map((x) => x.key);
    const list = st.candidatesFor(keys);
    const s = S();
    let h = `<div class="pmem-note">Ces propositions viennent de l’analyse <b>locale gratuite</b> (🧮) ou d’une extraction IA (🤖). Rien n’est mémorisé sans ton accord.</div>
<div class="pmem-bar">
<button type="button" class="menu_button" data-act="scan">🧮 Analyser l’historique (gratuit)</button>
<button type="button" class="menu_button" data-act="acceptall"${list.length ? '' : ' disabled'}>✓ Tout accepter</button>
<button type="button" class="menu_button" data-act="rejectall"${list.length ? '' : ' disabled'}>✗ Tout rejeter</button>
</div>`;
    h += `<div class="pmem-bar">${aiButton('extract', '🤖 Extraire avec l’IA (1 appel)')}</div>`;
    if (ui.lastResult) h += `<div class="pmem-note">${esc(ui.lastResult)}</div>`;
    if (!list.length) return h + '<div class="pmem-empty">Aucun candidat en attente 🎉</div>';
    return h + list.map((c) => `<div class="pmem-card cand" data-id="${c.id}">
<div class="pmem-card-top"><span class="pmem-type">${core.TYPE_ICONS[c.type] || ''} ${esc(core.TYPES[c.type] || c.type)}</span><span class="pmem-meta">${c.origin === 'ia' ? '🤖 IA' : '🧮 local'} · ${esc(st.scopeLabel(c.scope))} · ★${c.importance}</span></div>
<div class="pmem-text">${esc(c.text)}</div>
<div class="pmem-actions"><button type="button" data-act="c-ok" class="ok">✓ Garder</button><button type="button" data-act="c-edit">✎ Modifier</button><button type="button" data-act="c-no" class="danger">✗ Rejeter</button></div></div>`).join('');
}

/** Bouton IA à deux temps : 1er tap = estimation du coût, 2e tap = lancement. */
function aiButton(kind, label) {
    const s = S();
    const blocked = s.neverAI ? 'Mode « Ne jamais appeler l’IA » actif' : '';
    if (blocked) return `<button type="button" class="menu_button" disabled>${esc(label)}</button><span class="pmem-count">🚫 ${esc(blocked)}</span>`;
    if (ui.armed === kind) return `<button type="button" class="menu_button pmem-armed" data-act="ai-${kind}">⚠️ Confirmer ? (≈ ${fmtNum(ui.armedCost || 0)} tokens)</button>`;
    return `<button type="button" class="menu_button" data-act="ai-${kind}">${esc(label)}</button>`;
}

/* ---- onglet Injection */

function renderInj() {
    const li = eng.state.lastInjection;
    let last = 'Aucune génération depuis le chargement.';
    if (li) {
        const lines = li.picked.map((p) => `<div class="pmem-why">${p.pinned ? '📌' : '🎯'} <b>${esc(p.m.text.slice(0, 70))}</b> — ${esc(p.scopeLabel || '')} · ${p.tokens} tok · utilisé ${p.m.uses || 0}×</div>`).join('');
        last = `Dernière injection <b>réellement envoyée</b> : ${li.tokens} tokens, ${li.picked.length} souvenir(s) sur ${li.candidates} candidat(s) (${new Date(li.at).toLocaleTimeString('fr-FR')}) — ${li.speakerName ? `perso qui parlait : <b>${esc(li.speakerName)}</b>` : 'chat solo / orateur inconnu'}.${lines ? `<details open><summary>Détail</summary>${lines}</details>` : ''}${li.picked.length ? '' : `<details><summary>Pourquoi 0 ?</summary>${li.why.map((w) => `<div class="pmem-why">${esc(w)}</div>`).join('')}</details>`}`;
    }
    return `<div class="pmem-note">Aperçu de ce qui serait injecté <b>maintenant</b> (calcul local, aucun appel API ; même fonction que l’injection réelle). Tout est ajouté à la fin du prompt, à la profondeur choisie.</div>
<div class="pmem-bar"><input id="pmem-sim" class="text_pole" type="text" placeholder="Simuler : écris un message…" value="${esc(ui.sim)}"><button type="button" class="menu_button" data-act="sim">▶︎ Simuler</button><button type="button" class="menu_button" data-act="refresh">↻</button></div>
<div id="pmem-injbox" class="pmem-injbox">Calcul…</div>
<div class="pmem-bar"><button type="button" class="menu_button" data-act="testinj" id="pmem-testinj">🧪 Tester l’injection maintenant</button></div>
<div id="pmem-testbox" class="pmem-testbox">${ui.testHtml || ''}</div>
<div class="pmem-note" id="pmem-last">${last}</div>`;
}

function whyHtml(why) {
    return `<details class="pmem-diag" open><summary>Pourquoi / portées utilisées</summary>${why.map((w) => `<div class="pmem-why">${esc(w)}</div>`).join('')}</details>`;
}

async function loadInjPreview() {
    const box = $('#pmem-injbox');
    if (!box) return;
    try {
        const r = await eng.buildInjection({ type: 'normal', override: ui.sim ? ui.sim : null, speaker: st.currentGroup() ? null : undefined });
        eng.state.preview = r;
        const pct = Math.min(100, Math.round((r.tokens / Math.max(1, r.budget)) * 100));
        const over = r.tokens > r.budget;
        const rows = r.report.rows.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.usable} utilisable(s)${x.pinned ? ` · ${x.pinned} 📌` : ''}${x.disabled ? ` · ${x.disabled} désactivé(s)` : ''}${x.archived ? ` · ${x.archived} archivé(s)` : ''}</td></tr>`).join('');
        const ign = r.report.ignored.map((x) => `<tr class="pmem-ign"><td>⚠️ ${esc(x.label)}</td><td>${x.total} souvenir(s) non injecté(s) — ${esc(x.why)}</td></tr>`).join('');
        box.innerHTML = `<div class="pmem-meter"><div class="pmem-meter-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>
<div class="pmem-count"><b id="pmem-inj-tokens">${r.tokens}</b> / ${r.budget} tokens · ${r.picked.length} souvenir(s) sur ${r.candidates}</div>
${r.warnings.map((w) => `<div class="pmem-warn">⚠️ ${esc(w)}</div>`).join('')}
<pre id="pmem-preview" class="pmem-pre">${r.text ? esc(r.text) : '(rien à injecter : aucun souvenir pertinent ni épinglé)'}</pre>
${r.picked.length ? `<details><summary>Pourquoi ces souvenirs ?</summary>${r.picked.map((p) => `<div class="pmem-why">${p.pinned ? '📌' : '🎯'} <b>${esc(p.m.text.slice(0, 60))}</b> — ${esc(p.scopeLabel || '')} — ${p.pinned ? 'épinglé' : `score ${p.score.toFixed(2)} (mots : ${esc([...(p.hits || []), ...(p.kwHits || [])].join(', ') || '—')})`}</div>`).join('')}</details>` : ''}
${r.picked.length ? '' : whyHtml(r.why)}
<table class="pmem-table pmem-scopes">${rows}${ign}</table>`;
    } catch (e) { box.textContent = 'Erreur : ' + (e?.message || e); }
}

async function runTestInjection() {
    const box = $('#pmem-testbox');
    if (box) box.textContent = 'Calcul…';
    const res = await eng.testInjection({ override: ui.sim ? ui.sim : null });
    ui.testHtml = res.map((x) => `<details class="pmem-test" open><summary><b>${esc(x.label)}</b> → ${x.count} souvenir(s), ${x.tokens}/${x.budget} tokens</summary>${x.lines.map((l) => `<div class="pmem-why">${l.pinned ? '📌' : '🎯'} ${esc(l.text.slice(0, 80))} <i>(${esc(l.scope)}, ${l.tokens} tok)</i></div>`).join('') || '<div class="pmem-why">(rien)</div>'}${x.count ? '' : x.why.map((w) => `<div class="pmem-why">${esc(w)}</div>`).join('')}</details>`).join('');
    const b2 = $('#pmem-testbox');
    if (b2) b2.innerHTML = ui.testHtml;
    return res;
}

/* ---- onglet Coût */

function renderCost() {
    const s = S();
    const t = st.rollStats();
    const avg = t.injections ? Math.round(t.injectedTokensTotal / t.injections) : 0;
    const monthPct = s.maxTokensPerMonth ? Math.min(100, Math.round((t.tokensMonth / s.maxTokensPerMonth) * 100)) : 100;
    const dayPct = s.maxCallsPerDay ? Math.min(100, Math.round((t.callsToday / s.maxCallsPerDay) * 100)) : 100;
    return `<div class="pmem-note">Tout ce qui est local (sélection, détection, doublons) coûte <b>0 crédit</b>. Seuls les appels IA ci-dessous consomment des tokens (estimation).</div>
<table class="pmem-table">
<tr><td>Dernière injection</td><td><b>${fmtNum(t.lastInjectedTokens)}</b> tokens</td></tr>
<tr><td>Moyenne par message</td><td>${fmtNum(avg)} tokens (${fmtNum(t.injections)} messages)</td></tr>
<tr><td>Budget d’injection</td><td>${fmtNum(s.maxTokens)} tokens · ${s.maxMemories} souvenirs max</td></tr>
<tr><td>Appels IA aujourd’hui</td><td><b>${t.callsToday}</b> / ${s.maxCallsPerDay}<div class="pmem-meter"><div class="pmem-meter-fill" style="width:${dayPct}%"></div></div></td></tr>
<tr><td>Tokens IA aujourd’hui (est.)</td><td>${fmtNum(t.tokensToday)}</td></tr>
<tr><td>Tokens IA ce mois (est.)</td><td>${fmtNum(t.tokensMonth)} / ${fmtNum(s.maxTokensPerMonth)}<div class="pmem-meter"><div class="pmem-meter-fill" style="width:${monthPct}%"></div></div></td></tr>
<tr><td>Appels IA au total</td><td>${fmtNum(t.callsTotal)} · ≈ ${fmtNum(t.tokensTotal)} tokens</td></tr>
<tr><td>Appels refusés (plafond / mode local)</td><td>${fmtNum(t.blocked)}</td></tr>
<tr><td>Mode</td><td>${s.neverAI ? '🚫 Ne jamais appeler l’IA' : s.autoExtract || s.autoSummary ? '🤖 Auto : ' + [s.autoExtract ? `extraction /${s.autoEvery} msg` : '', s.autoSummary ? `résumé /${s.summaryEvery} msg` : ''].filter(Boolean).join(' + ') : '✋ Manuel (aucun appel automatique)'}</td></tr>
</table>
<div class="pmem-bar"><button type="button" class="menu_button" data-act="eco">💰 Mode économie</button><button type="button" class="menu_button" data-act="never">${s.neverAI ? '✅ Autoriser l’IA' : '🚫 Ne jamais appeler l’IA'}</button><button type="button" class="menu_button" data-act="resetstats">↺ Remettre à zéro</button></div>
${st.storeStatus.error ? `<div class="pmem-warn">⚠️ Stockage : ${esc(st.storeStatus.error)}</div>` : ''}`;
}

/* ---- onglet Outils */

function renderTools() {
    let h = `<div class="pmem-sec2"><h4>Résumé glissant</h4><div class="pmem-note">Un seul souvenir « Résumé » par chat, toujours injecté (épinglé). 1 appel IA, plafonné.</div>
<div class="pmem-bar">${aiButton('summary', '📝 Mettre à jour le résumé (IA)')}</div></div>
<div class="pmem-sec2"><h4>Doublons</h4><div class="pmem-bar"><select id="pmem-dupscope" class="text_pole">${scopeOptions(ui.scope === '__cur' ? (st.viewerScopes()[0]?.key || 'world') : ui.scope)}</select><button type="button" class="menu_button" data-act="finddup">🔍 Chercher (gratuit)</button></div>`;
    if (ui.dupPairs) {
        h += ui.dupPairs.pairs.length ? ui.dupPairs.pairs.map((p, i) => `<div class="pmem-card"><div class="pmem-meta">similarité ${Math.round(p.score * 100)} %</div><div class="pmem-text">A : ${esc(p.a.text)}</div><div class="pmem-text">B : ${esc(p.b.text)}</div><div class="pmem-actions"><button type="button" data-act="merge" data-i="${i}" class="ok">🧬 Fusionner (garde A)</button><button type="button" data-act="dismissdup" data-i="${i}">Ignorer</button></div></div>`).join('') : '<div class="pmem-empty">Aucun doublon 👍</div>';
    }
    h += `</div><div class="pmem-sec2"><h4>Archivage</h4><div class="pmem-note">Les souvenirs d’importance ≤ 2, non épinglés et inutilisés depuis ${S().archiveDays} jours sont <b>archivés</b> (jamais supprimés, restaurables).</div>
<div class="pmem-bar"><button type="button" class="menu_button" data-act="archive-now">🗄 Archiver maintenant</button></div></div>
<div class="pmem-sec2"><h4>Import / export / sauvegarde</h4>
<div class="pmem-bar"><select id="pmem-exscope" class="text_pole"><option value="__all">Tout (toutes les portées)</option>${scopeOptions('', {})}</select></div>
<div class="pmem-bar"><button type="button" class="menu_button" data-act="export">⬇️ Exporter (JSON)</button><button type="button" class="menu_button" data-act="backup">💾 Sauvegarde complète</button></div>
<div class="pmem-bar"><select id="pmem-immode" class="text_pole"><option value="fusion">Import : fusionner</option><option value="remplacer">Import : remplacer les portées</option></select><button type="button" class="menu_button" data-act="import">⬆️ Importer un JSON</button><input type="file" id="pmem-file" accept="application/json,.json" hidden></div>
<div class="pmem-note">Stockage : <code>user/files/${st.FILE}</code> (sur le serveur SillyTavern) · ${st.storeStatus.loaded ? `dernière sauvegarde ${st.storeStatus.lastSave ? new Date(st.storeStatus.lastSave).toLocaleTimeString('fr-FR') : '—'}` : '⚠️ non chargé'}</div></div>
<div class="pmem-sec2"><h4>Zone dangereuse</h4><div class="pmem-bar"><select id="pmem-wipescope" class="text_pole">${scopeOptions('')}</select><button type="button" class="menu_button danger" data-act="wipe">${ui.armed === 'wipe' ? '⚠️ Confirmer la suppression' : '🗑 Vider cette portée'}</button></div></div>`;
    return h;
}

/* ------------------------------------------------------------------ événements du panneau */

function onSheetInput(e) {
    const t = e.target;
    if (t.id === 'pmem-scope') { ui.scope = t.value; renderSheet(); }
    else if (t.id === 'pmem-q') { ui.q = t.value; renderSheet(); }
    else if (t.id === 'pmem-ftype') { ui.type = t.value; renderSheet(); }
    else if (t.id === 'pmem-fstatus') { ui.status = t.value; renderSheet(); }
    else if (t.id === 'pmem-sim') ui.sim = t.value;
    else if (t.classList?.contains('pmem-reassign') && e.type === 'change') {
        const to = t.value; const from = t.dataset.key;
        if (to && to !== from && st.moveMemory(from, t.dataset.id, to)) st.toast('success', `Attribué à : ${st.scopeLabel(to)}`);
        renderSheet();
    }
    else if (t.id === 'pmem-file' && e.type === 'change') doImport(t.files?.[0]);
}

function arm(kind, cost) {
    ui.armed = kind; ui.armedCost = cost;
    clearTimeout(arm.t);
    arm.t = setTimeout(() => { if (ui.armed === kind) { ui.armed = null; if (ui.open) renderSheet(); } }, 6000);
}

async function onSheetClick(e) {
    const btn = e.target.closest('[data-act]');
    const tab = e.target.closest('[data-tab]');
    if (tab) { ui.tab = tab.dataset.tab; ui.armed = null; renderSheet(); return; }
    if (e.target.id === 'pmem-sheet') { closeSheet(); return; }
    if (!btn) return;
    const act = btn.dataset.act;
    const card = btn.closest('.pmem-card');
    const key = btn.dataset.key || card?.dataset.key;
    const id = btn.dataset.id || card?.dataset.id;
    const get = () => st.getList(key, false).find((m) => m.id === id);
    const cand = () => st.store.candidates.find((c) => c.id === id);
    switch (act) {
        case 'close': closeSheet(); break;
        case 'star': st.updateMemory(key, id, { importance: Number(btn.dataset.n) }); break;
        case 'pin': { const m = get(); st.updateMemory(key, id, { pinned: !m.pinned }); break; }
        case 'toggle': { const m = get(); st.updateMemory(key, id, { enabled: !m.enabled }); break; }
        case 'archive': { const m = get(); st.updateMemory(key, id, { archived: !m.archived }); break; }
        case 'edit': { const m = get(); if (m) openEditor({ mode: 'edit', key, entry: m }); break; }
        case 'del': {
            if (btn.dataset.armed) { st.deleteMemory(key, id); st.toast('info', 'Souvenir supprimé'); }
            else { btn.dataset.armed = '1'; btn.textContent = 'Confirmer ?'; setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = '🗑'; } }, 3000); }
            break;
        }
        case 'new': openEditor({ mode: 'new', key: st.viewerScopes().find((x) => x.key === ui.scope)?.key || attribScopes()[0]?.key || 'world' }); break;
        case 'c-ok': { const c = cand(); if (c) { st.acceptCandidate(id); st.toast('success', 'Souvenir ajouté'); } break; }
        case 'c-no': st.rejectCandidate(id); break;
        case 'c-edit': { const c = cand(); if (c) openEditor({ mode: 'cand', key: c.scope, entry: c }); break; }
        case 'acceptall': { const keys = st.viewerScopes().map((x) => x.key); const l = st.candidatesFor(keys).slice(); l.forEach((c) => st.acceptCandidate(c.id)); st.toast('success', `${l.length} souvenir(s) ajouté(s)`); break; }
        case 'rejectall': { const keys = st.viewerScopes().map((x) => x.key); st.candidatesFor(keys).slice().forEach((c) => st.rejectCandidate(c.id)); break; }
        case 'scan': {
            const last = (ctx().chat?.length || 1) - 1;
            const n = eng.scanMessages(last - 40, last, { notify: true });
            ui.lastResult = `Analyse locale de l’historique récent : ${n} nouveau(x) candidat(s). Coût : 0.`;
            renderSheet(); break;
        }
        case 'ai-extract': {
            if (ui.armed !== 'extract') { const est = await eng.estimateExtraction(); arm('extract', est.input + est.output); renderSheet(); break; }
            ui.armed = null; btn.disabled = true; btn.textContent = '⏳ Extraction…';
            const r = await eng.runExtraction({ manual: true });
            ui.lastResult = r.ok ? `Extraction IA : ${r.found} fait(s) trouvé(s), ${r.added} nouveau(x) candidat(s) · ≈ ${r.inputTokens + r.outTokens} tokens.` : `Extraction non effectuée : ${r.reason}`;
            if (!r.ok) st.toast('warning', r.reason);
            renderSheet(); break;
        }
        case 'ai-summary': {
            if (ui.armed !== 'summary') { arm('summary', S().summaryMaxTokens + 600); renderSheet(); break; }
            ui.armed = null; btn.disabled = true; btn.textContent = '⏳ Résumé…';
            const r = await eng.runSummary({ manual: true });
            st.toast(r.ok ? 'success' : 'warning', r.ok ? 'Résumé mis à jour' : r.reason);
            renderSheet(); break;
        }
        case 'sim': ui.sim = $('#pmem-sim')?.value || ''; loadInjPreview(); break;
        case 'refresh': loadInjPreview(); break;
        case 'testinj': await runTestInjection(); return;
        case 'eco': st.applyPreset('economie'); S().neverAI = false; st.saveSettings(); syncControls(); st.emitChange(); st.toast('success', 'Mode économie activé'); break;
        case 'never': S().neverAI = !S().neverAI; st.saveSettings(); syncControls(); st.emitChange(); break;
        case 'resetstats': st.resetStats(); break;
        case 'finddup': { const k = $('#pmem-dupscope').value; ui.dupScope = k; ui.dupPairs = { key: k, pairs: eng.duplicatesIn(k) }; renderSheet(); break; }
        case 'merge': { const p = ui.dupPairs.pairs[Number(btn.dataset.i)]; eng.mergeDuplicate(ui.dupPairs.key, p.a.id, p.b.id); ui.dupPairs.pairs = eng.duplicatesIn(ui.dupPairs.key); st.toast('success', 'Fusionné'); renderSheet(); break; }
        case 'dismissdup': ui.dupPairs.pairs.splice(Number(btn.dataset.i), 1); renderSheet(); break;
        case 'archive-now': { const n = eng.runArchive({ force: true }); st.toast('info', `${n} souvenir(s) archivé(s)`); renderSheet(); break; }
        case 'export': {
            const v = $('#pmem-exscope').value;
            const data = st.exportData(v === '__all' ? null : [v]);
            st.downloadJSON(`memoire-permanente-${v === '__all' ? 'tout' : v.replace(/[^a-z0-9]+/gi, '_')}-${st.todayKey()}.json`, data);
            st.toast('success', `Export : ${Object.values(data.scopes).reduce((a, s) => a + s.memories.length, 0)} souvenir(s)`);
            break;
        }
        case 'backup': {
            st.downloadJSON(`memoire-permanente-sauvegarde-${st.todayKey()}.json`, st.exportData(null));
            try { const n = await st.backupToServer(); st.toast('success', `Sauvegarde téléchargée + copie serveur (${n})`); } catch (err) { st.toast('warning', 'Copie serveur impossible : ' + err.message); }
            break;
        }
        case 'import': $('#pmem-file').click(); break;
        case 'wipe': {
            if (ui.armed !== 'wipe') { arm('wipe', 0); renderSheet(); break; }
            ui.armed = null;
            const k = $('#pmem-wipescope').value;
            const l = st.getList(k, false);
            const n = l.length; l.length = 0;
            if (k === 'chat') st.saveChatData(); else st.markDirty();
            st.emitChange(); st.toast('info', `${n} souvenir(s) supprimé(s)`); renderSheet(); break;
        }
        default: return;
    }
    renderSoon();
}

async function doImport(file) {
    if (!file) return;
    try {
        const obj = JSON.parse(await file.text());
        const r = st.importData(obj, $('#pmem-immode')?.value || 'fusion');
        st.toast('success', `Import : ${r.added} ajouté(s), ${r.skipped} ignoré(s)`);
    } catch (e) { st.toast('error', 'Import impossible : ' + (e?.message || e)); }
    const f = $('#pmem-file'); if (f) f.value = '';
    renderSoon();
}

/* ------------------------------------------------------------------ éditeur (nouveau / modifier / candidat) */

export function openEditor({ mode = 'new', key, entry = null, text = '', type = 'fait', importance = 3, idx = null, keywords = '', pinned = false, onSave = null }) {
    $('#pmem-dialog')?.remove();
    const m = entry || { text, type, importance, keywords: typeof keywords === 'string' ? keywords.split(',') : keywords, pinned };
    const opts = attribOptions(key);
    const d = document.createElement('div');
    d.id = 'pmem-dialog';
    d.innerHTML = `<div class="pmem-dlg" role="dialog">
<h4>${mode === 'edit' ? '✎ Modifier le souvenir' : mode === 'cand' ? '✎ Modifier le candidat' : '➕ Nouveau souvenir'}</h4>
<label>Texte (court = moins de tokens)<textarea id="pmem-d-text" class="text_pole" rows="4" maxlength="600">${esc(m.text)}</textarea></label>
<div class="pmem-dcount" id="pmem-d-count"></div>
<label>Type<select id="pmem-d-type" class="text_pole">${typeOptions(m.type)}</select></label>
<label>Importance<span class="pmem-stars" id="pmem-d-stars" data-n="${m.importance}">${stars(m.importance)}</span></label>
<label>Mots-clés (séparés par des virgules)<input id="pmem-d-kw" class="text_pole" type="text" value="${esc((m.keywords || []).join(', '))}"></label>
<label>Attribuer à (tout le groupe / personnage / monde)<select id="pmem-d-scope" class="text_pole">${opts}</select></label>
<label class="checkbox_label"><input type="checkbox" id="pmem-d-pin"${m.pinned ? ' checked' : ''}><span>📌 Épinglé (toujours injecté)</span></label>
<div class="pmem-dbtns"><button type="button" class="menu_button" id="pmem-d-cancel">Annuler</button><button type="button" class="menu_button ok" id="pmem-d-save">Enregistrer</button></div>
</div>`;
    document.body.appendChild(d);
    const area = $('#pmem-d-text', d);
    const count = () => { $('#pmem-d-count', d).textContent = `≈ ${core.estTokens(area.value)} tokens`; };
    area.addEventListener('input', count); count();
    let imp = m.importance;
    $('#pmem-d-stars', d).addEventListener('click', (e) => {
        const b = e.target.closest('[data-n]'); if (!b) return;
        imp = Number(b.dataset.n);
        $$('.pmem-star', d).forEach((s) => s.classList.toggle('on', Number(s.dataset.n) <= imp));
    });
    $('#pmem-d-cancel', d).addEventListener('click', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) d.remove(); });
    $('#pmem-d-save', d).addEventListener('click', () => {
        const fields = { text: area.value, type: $('#pmem-d-type', d).value, importance: imp, keywords: $('#pmem-d-kw', d).value, pinned: $('#pmem-d-pin', d).checked };
        const scope = $('#pmem-d-scope', d).value;
        if (!core.cleanText(fields.text)) { st.toast('warning', 'Le texte est vide'); return; }
        if (mode === 'edit') {
            st.updateMemory(key, entry.id, fields);
            if (scope !== key) st.moveMemory(key, entry.id, scope);
        } else if (mode === 'cand') {
            Object.assign(entry, core.makeMemory({ ...entry, ...fields }, new Set()), { id: entry.id, scope: entry.scope, origin: entry.origin, chat: entry.chat });
            st.acceptCandidate(entry.id, { scope });
        } else {
            const r = st.addMemory(scope, { ...fields, src: { idx, chat: ctx().getCurrentChatId?.() ?? null } });
            if (r.duplicate) st.toast('warning', `Proche d’un souvenir existant (« ${r.duplicate.text.slice(0, 40)}… ») — ajouté quand même ; voir Outils › Doublons`);
            else st.toast('success', 'Souvenir ajouté');
        }
        d.remove();
        onSave?.();
        renderSoon();
    });
    area.focus();
}

/** Bouton 🧠 d'un message : propose le texte (sélection > phrases clés) et ouvre l'éditeur. */
export function memorizeMessage(mesId) {
    const m = ctx().chat?.[mesId];
    if (!m) return;
    const sel = String(globalThis.getSelection?.() || '').trim();
    const base = sel.length > 5 ? core.cleanText(sel) : core.trimMessageForMemory(m.mes, 220);
    const g = st.currentGroup();
    let key;
    if (g) {
        const av = !m.is_user ? (m.original_avatar || st.avatarByName(m.name)) : null;
        key = av ? `char:${av}` : `group:${g.id}`;
    } else key = st.viewerScopes()[0]?.key || 'world';
    const sc = core.scoreSentence(base);
    openEditor({ mode: 'new', key, text: `${m.name} : ${base}`, type: sc.type, importance: Math.min(5, Math.max(3, sc.imp)), keywords: core.autoKeywords(base).join(', '), idx: mesId });
}

/* ------------------------------------------------------------------ bouton flottant */

let moveMode = false;
function ensureFloat() {
    let el = document.getElementById('pmem-float');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'pmem-float';
    el.innerHTML = '<button type="button" id="pmem-float-btn" aria-label="Mémoire">🧠<span class="pmem-fbadge" hidden></span></button><div class="pmem-move-label">Déplacer</div>';
    document.body.appendChild(el);
    const done = document.createElement('button');
    done.id = 'pmem-move-done'; done.type = 'button'; done.textContent = '✔ Terminer le déplacement';
    done.addEventListener('click', () => setMoveMode(false));
    document.body.appendChild(done);
    el.querySelector('#pmem-float-btn').addEventListener('click', () => { if (!moveMode) openSheet('mem'); });
    bindDrag(el);
    return el;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function floatBounds(el) {
    const w = el.offsetWidth || 46; const h = el.offsetHeight || 46;
    const vw = window.innerWidth; const vh = window.innerHeight;
    const form = document.getElementById('form_sheld');
    let formTop = vh;
    if (form && form.offsetParent !== null) { const r = form.getBoundingClientRect(); if (r.height > 0 && r.top > 0) formTop = r.top; }
    const bar = document.getElementById('top-bar');
    const barBottom = bar && bar.offsetParent !== null ? bar.getBoundingClientRect().bottom : 0;
    const minL = 6; const maxL = Math.max(minL, vw - w - 6);
    const minT = Math.max(6, barBottom + 6); const maxT = Math.max(minT, Math.min(vh, formTop) - h - 6);
    return { minL, maxL, minT, maxT };
}
export function updateFloat() {
    const s = S();
    const el = ensureFloat();
    const c = ctx();
    const chatOpen = c.characterId !== undefined || !!c.groupId;
    el.classList.toggle('pmem-show', !!(s.enabled && (moveMode || (s.floating && chatOpen))));
    el.classList.toggle('pmem-move', moveMode);
    document.getElementById('pmem-move-done')?.classList.toggle('pmem-show', moveMode);
    el.style.setProperty('--pmem-size', `${s.floatSize}px`);
    const b = floatBounds(el);
    el.style.left = `${Math.round(b.minL + (s.floatX / 100) * (b.maxL - b.minL))}px`;
    el.style.top = `${Math.round(b.minT + (s.floatY / 100) * (b.maxT - b.minT))}px`;
    const n = pendingCount();
    const badge = el.querySelector('.pmem-fbadge');
    badge.hidden = !n; badge.textContent = String(n);
}
function bindDrag(el) {
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
        if (!moveMode) return;
        e.preventDefault();
        const b = floatBounds(el);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0, b };
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        e.preventDefault();
        el.style.left = `${clamp(drag.left + e.clientX - drag.x, drag.b.minL, drag.b.maxL)}px`;
        el.style.top = `${clamp(drag.top + e.clientY - drag.y, drag.b.minT, drag.b.maxT)}px`;
    });
    const end = (e) => {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        const b = drag.b; const s = S();
        s.floatX = b.maxL > b.minL ? Math.round(clamp((parseFloat(el.style.left) - b.minL) / (b.maxL - b.minL), 0, 1) * 100) : 0;
        s.floatY = b.maxT > b.minT ? Math.round(clamp((parseFloat(el.style.top) - b.minT) / (b.maxT - b.minT), 0, 1) * 100) : 0;
        drag = null;
        st.saveSettings(); syncControls();
        $('#pmem_f_floatX') && ($('#pmem_f_floatX').value = s.floatX);
        $('#pmem_f_floatY') && ($('#pmem_f_floatY').value = s.floatY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
}
export function setMoveMode(on) {
    moveMode = !!on;
    if (moveMode) closeSheet();
    updateFloat(); syncControls();
}

/* ------------------------------------------------------------------ menu baguette + boutons de messages */

export function placeWand() {
    let item = document.getElementById('pmem_wand_button');
    if (!S().wand) { item?.remove(); return; }
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    if (!item) {
        item = document.createElement('div');
        item.id = 'pmem_wand_button';
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;
        item.innerHTML = '<div class="extensionsMenuExtensionButton pmem-wand-icon">🧠</div><span>Mémoire</span>';
        item.addEventListener('click', () => { document.getElementById('extensionsMenu') && $('#extensionsMenuButton')?.click(); openSheet('mem'); });
        menu.appendChild(item);
    }
}

export function decorateMessages() {
    const on = S().enabled && S().messageButton;
    $$('#chat .mes').forEach((mes) => {
        const bar = mes.querySelector('.extraMesButtons');
        if (!bar) return;
        const has = bar.querySelector('.pmem-mes-btn');
        if (!on) { has?.remove(); return; }
        if (has || mes.classList.contains('smallSysMes') || mes.getAttribute('is_system') === 'true') return;
        const b = document.createElement('div');
        b.className = 'mes_button pmem-mes-btn fa-solid fa-brain interactable';
        b.title = 'Mémoriser ce message'; b.tabIndex = 0; b.setAttribute('role', 'button');
        bar.appendChild(b);
    });
}

function onDocClick(e) {
    const b = e.target.closest?.('.pmem-mes-btn');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const id = Number(b.closest('.mes')?.getAttribute('mesid'));
    if (Number.isInteger(id)) memorizeMessage(id);
}

/* ------------------------------------------------------------------ init */

export function refreshAll() {
    placeWand();
    decorateMessages();
    updateFloat();
    syncControls();
    if (ui.open) renderSheet();
}

export function initUI() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (host && !document.getElementById('pmem_settings')) {
        host.insertAdjacentHTML('beforeend', settingsHtml());
        bindSettings();
    }
    ensureSheet();
    ensureFloat();
    document.addEventListener('click', onDocClick, true);
    const chat = document.getElementById('chat');
    if (chat) {
        let q = false;
        new MutationObserver(() => { if (q) return; q = true; requestAnimationFrame(() => { q = false; decorateMessages(); }); }).observe(chat, { childList: true });
    }
    window.addEventListener('resize', () => updateFloat());
    st.onChange(renderSoon);
    refreshAll();
    // le menu baguette peut arriver après nous
    let tries = 0;
    const t = setInterval(() => { placeWand(); if (document.getElementById('pmem_wand_button') || !S().wand || ++tries > 40) clearInterval(t); }, 500);
}
