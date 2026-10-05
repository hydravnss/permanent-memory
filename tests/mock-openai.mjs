// Faux backend OpenAI-compatible (enregistre les prompts reçus).
//   node tests/mock-openai.mjs [port]   (défaut 9101)
//   POST /_ctl {"queue":[...],"default":"ok"} · GET /_log · DELETE /_log
//   GET  /_log  → requêtes reçues (messages envoyés au "modèle")     DELETE /_log → vide
// Délai : {"delay": ms} global ou {kind, delay} par réponse.
// Comportements : ok (texte variable) · empty (réponse vide) · error (HTTP 500) · slow (flux lent ~4 s) · hang (ne répond jamais)
import http from 'node:http';

const port = Number(process.argv[2] || 9101);
let queue = [];
let dflt = 'ok';
let rules = [];
let globalDelay = 0; // POST /_ctl {"delay": 3000} : délai appliqué à chaque réponse // [{match: 'regex', text}] : répond ce texte si le prompt correspond
let counter = 0;
const log = [];
const WORDS = ['aurore', 'brume', 'cerisier', 'dragon', 'étoile', 'falaise', 'givre', 'horizon', 'iris', 'jasmin'];

const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (url === '/_ctl' && req.method === 'POST') {
            const o = JSON.parse(body || '{}');
            if (o.queue) queue = o.queue;
            if (o.default) dflt = o.default;
            if (o.rules) rules = o.rules;
            if (o.delay !== undefined) globalDelay = Number(o.delay) || 0;
            return json(200, { queue, default: dflt });
        }
        if (url === '/_log') {
            if (req.method === 'DELETE') { log.length = 0; return json(200, { ok: true }); }
            return json(200, log);
        }
        if (url.endsWith('/models')) return json(200, { object: 'list', data: [{ id: 'mock-model', object: 'model' }] });
        if (url.endsWith('/chat/completions') && req.method === 'POST') {
            let payload = {};
            try { payload = JSON.parse(body); } catch { /* ignore */ }
            const ruleHit = rules.find((r) => new RegExp(r.match).test(JSON.stringify(payload.messages || [])));
            const behavior = ruleHit ? { kind: 'ok', text: ruleHit.text } : (queue.length ? queue.shift() : dflt);
            counter++;
            log.push({ n: counter, behavior, stream: !!payload.stream, messages: payload.messages });
            const text = typeof behavior === 'object' && behavior.text ? behavior.text : `Réponse n°${counter} — ${WORDS[counter % WORDS.length]} ${Math.random().toString(36).slice(2, 6)}.`;
            const kind = typeof behavior === 'object' ? (behavior.kind || 'ok') : behavior;
            if (kind === 'hang') return; // la connexion reste ouverte indéfiniment
            if (kind === 'error') return json(500, { error: { message: 'Erreur simulée par le faux backend', type: 'server_error' } });
            const out = kind === 'empty' ? '' : text;
            const delay = Number((typeof behavior === 'object' && behavior.delay) || globalDelay) || 0; // délai de réponse simulé (ms)
            if (delay && !res.delayed) { res.delayed = true; return setTimeout(() => { if (!res.destroyed) answer(); }, delay); }
            return answer();
            function answer() {
            if (!payload.stream) {
                return json(200, { id: 'mock-' + counter, object: 'chat.completion', created: 0, model: 'mock-model', choices: [{ index: 0, message: { role: 'assistant', content: out }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
            }
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
            const chunks = out.match(/.{1,6}/g) || [];
            const gap = kind === 'slow' ? 500 : 15;
            let i = 0;
            const tick = () => {
                if (res.destroyed) return;
                if (i < chunks.length) {
                    res.write(`data: ${JSON.stringify({ id: 'mock-' + counter, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: chunks[i++] }, finish_reason: null }] })}\n\n`);
                    setTimeout(tick, gap);
                } else {
                    res.write(`data: ${JSON.stringify({ id: 'mock-' + counter, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();
                }
            };
            tick();
            }
            return;
        }
        json(404, { error: 'not found ' + url });
    });
});
server.listen(port, '127.0.0.1', () => console.log('mock openai on', port));
