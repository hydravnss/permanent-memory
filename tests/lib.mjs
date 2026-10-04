// Utilitaires de test (Playwright WebKit, iPhone 14 Pro) pour Mémoire Permanente.
// Prérequis : SillyTavern (défaut http://localhost:8011/) avec l'extension, et `node tests/mock-openai.mjs 9101`.
const pwPath = process.env.PW_PATH || '/workspace/pw/node_modules/playwright/index.mjs';
const { webkit, devices } = await import(pwPath);

export const ST = process.env.ST_URL || 'http://localhost:8011/';
export const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:9101';
export const SHOTS = process.env.SHOTS || '/workspace/st-test-shots';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mock(ctl) { return (await fetch(`${MOCK}/_ctl`, { method: 'POST', body: JSON.stringify(ctl) })).json(); }
export const mockLog = async () => (await fetch(`${MOCK}/_log`)).json();
export const mockClear = async () => { await fetch(`${MOCK}/_log`, { method: 'DELETE' }); await mock({ queue: [], default: 'ok' }); };

export async function boot({ context: ctxOpts } = {}) {
    const browser = await webkit.launch();
    const context = await browser.newContext({ ...devices['iPhone 14 Pro'], hasTouch: true, ...(ctxOpts || {}) });
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', (e) => { errs.push('PAGEERROR ' + e.message.slice(0, 300)); console.log('PAGEERROR', e.message.slice(0, 300)); });
    page.on('console', (m) => {
        if (m.type() === 'error' && !/interactive-widget|Failed to load resource|Extension update failed|image-metadata|ImageMetadata|Error loading folders/.test(m.text())) { errs.push('CONSOLE ' + m.text().slice(0, 300)); console.log('CONSOLE', m.text().slice(0, 300)); }
    });
    await page.goto(ST);
    await page.waitForFunction(() => globalThis.permanentMemory?.ready && globalThis.SillyTavern?.getContext()?.eventSource, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    // première ouverture d'une instance neuve : ST demande le nom du persona
    const popup = page.locator('dialog.popup[open] .popup-input');
    if (await popup.count()) {
        await popup.first().fill('Léo');
        await page.locator('dialog.popup[open] .popup-button-ok').first().click();
        await page.waitForTimeout(1500);
    }
    return { browser, context, page, errs };
}

export const ok = (cond, msg) => { console.log(cond ? 'OK   ' : 'ECHEC', msg); if (!cond) process.exitCode = 1; return cond; };
export const shot = (page, name) => page.screenshot({ path: `${SHOTS}/mem-${name}.png` });

/** Connecte ST au faux backend (Chat Completion → Custom), sans streaming. */
export async function connect(page) {
    await page.evaluate(async (mockUrl) => {
        const c = SillyTavern.getContext();
        const o = c.chatCompletionSettings;
        o.chat_completion_source = 'custom';
        o.custom_url = `${mockUrl}/v1`;
        o.custom_model = 'mock-model';
        o.stream_openai = false;
        o.openai_max_tokens = 200;
        o.openai_max_context = 8000;
        $('#main_api').val('openai').trigger('change');
        $('#chat_completion_source').val('custom').trigger('change');
        $('#custom_api_url_text').val(`${mockUrl}/v1`).trigger('input');
        $('#custom_model_id').val('mock-model').trigger('input');
        $('#api_button_openai').trigger('click');
    }, MOCK);
    await page.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 25000 });
}

export async function selectChar(page, name = 'Seraphina') {
    await page.evaluate(async (n) => {
        const c = SillyTavern.getContext();
        await c.selectCharacterById(c.characters.findIndex((x) => x.name === n));
    }, name);
    await page.waitForTimeout(1800);
}

/** Envoie un message utilisateur par l'UI et attend la fin de la génération. */
export async function say(page, text, { wait = true } = {}) {
    await page.evaluate((t) => { $('#send_textarea').val(t).trigger('input'); $('#send_but').trigger('click'); }, text);
    if (wait) await idle(page);
}

export async function idle(page, timeout = 30000) {
    await page.waitForTimeout(400);
    await page.waitForFunction(() => {
        const stop = document.querySelector('#stop_but');
        return !stop || stop.offsetParent === null || getComputedStyle(stop).display === 'none';
    }, null, { timeout }).catch(() => {});
    await page.waitForTimeout(700);
}

/** Dernier prompt envoyé au faux backend → texte de tous les messages. */
export async function lastPrompt() {
    const log = (await mockLog()).filter((r) => r.messages);
    const last = log[log.length - 1];
    return last ? last.messages.map((m) => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n') : '';
}

export const pm = (page, fn, arg) => page.evaluate(fn, arg);

/** Crée un personnage « Bob » et un groupe Seraphina+Bob si absents. */
export async function ensureBobAndGroup(page) {
    return page.evaluate(async () => {
        const c = SillyTavern.getContext();
        if (!c.characters.find((x) => x.name === 'Bob')) {
            const fd = new FormData();
            fd.append('ch_name', 'Bob'); fd.append('file_name', 'Bob'); fd.append('description', 'Bob est un forgeron.'); fd.append('first_mes', 'Salut, je suis Bob.');
            fd.append('avatar_url', 'none'); fd.append('tags', ''); fd.append('personality', ''); fd.append('scenario', ''); fd.append('mes_example', ''); fd.append('creator_notes', ''); fd.append('system_prompt', ''); fd.append('post_history_instructions', ''); fd.append('creator', ''); fd.append('character_version', ''); fd.append('alternate_greetings', ''); fd.append('talkativeness', '0.5'); fd.append('fav', 'false'); fd.append('world', '');
            const h = c.getRequestHeaders(); delete h['Content-Type'];
            const r = await fetch('/api/characters/create', { method: 'POST', headers: h, body: fd });
            if (!r.ok) throw new Error('create Bob ' + r.status);
            await c.getCharacters();
        }
        const sera = c.characters.find((x) => x.name === 'Seraphina');
        const bob = c.characters.find((x) => x.name === 'Bob');
        let g = c.groups.find((x) => x.name === 'Groupe MEM');
        if (!g) {
            const r = await fetch('/api/groups/create', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ name: 'Groupe MEM', members: [sera.avatar, bob.avatar], avatar_url: '', chat_id: 'mem-group-chat-1', chats: ['mem-group-chat-1'] }) });
            if (!r.ok) throw new Error('create group ' + r.status);
            const gm = await import('/scripts/group-chats.js');
            await gm.getGroups();
            g = SillyTavern.getContext().groups.find((x) => x.name === 'Groupe MEM');
        }
        return { sera: sera.avatar, bob: bob.avatar, gid: g.id };
    });
}

/** Crée un personnage simple s'il n'existe pas. */
export async function ensureChar(page, name) {
    return page.evaluate(async (n) => {
        const c = SillyTavern.getContext();
        if (!c.characters.find((x) => x.name === n)) {
            const fd = new FormData();
            fd.append('ch_name', n); fd.append('file_name', n); fd.append('description', `${n} est un personnage de test.`); fd.append('first_mes', `Bonjour, je suis ${n}.`);
            fd.append('avatar_url', 'none'); fd.append('tags', ''); fd.append('personality', ''); fd.append('scenario', ''); fd.append('mes_example', ''); fd.append('creator_notes', ''); fd.append('system_prompt', ''); fd.append('post_history_instructions', ''); fd.append('creator', ''); fd.append('character_version', ''); fd.append('alternate_greetings', ''); fd.append('talkativeness', '0.5'); fd.append('fav', 'false'); fd.append('world', '');
            const h = c.getRequestHeaders(); delete h['Content-Type'];
            const r = await fetch('/api/characters/create', { method: 'POST', headers: h, body: fd });
            if (!r.ok) throw new Error('create ' + n + ' ' + r.status);
            await c.getCharacters();
        }
        return SillyTavern.getContext().characters.find((x) => x.name === n).avatar;
    }, name);
}
