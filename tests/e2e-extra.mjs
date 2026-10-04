// Tests complémentaires : déplacement tactile du bouton flottant, résumé automatique (1 appel / intervalle).
import { boot, connect, selectChar, say, mock, mockLog, mockClear, shot, ok, sleep } from './lib.mjs';
const { browser, page, errs } = await boot();
await connect(page);
const P = (fn, arg) => page.evaluate(fn, arg);
const setS = (patch) => P((p) => { Object.assign(globalThis.permanentMemory.settings(), p); }, patch);
await selectChar(page, 'Seraphina');

// --- déplacement
await setS({ floating: true, floatX: 50, floatY: 50 });
await P(() => { globalThis.permanentMemory.ui.refreshAll(); });
await P(() => globalThis.permanentMemory.ui.setMoveMode(true));
await page.waitForTimeout(400);
const r0 = await P(() => { const r = document.querySelector('#pmem-float').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.move(r0.x, r0.y);
await page.mouse.down();
await page.mouse.move(r0.x + 60, r0.y - 90, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const sx = await P(() => [globalThis.permanentMemory.settings().floatX, globalThis.permanentMemory.settings().floatY]);
ok(sx[0] !== 50 && sx[1] !== 50, `Glisser le bouton en mode déplacement met à jour X/Y (${sx})`);
await shot(page, '14-deplacement');
const stillSheet = await page.locator('#pmem-sheet.pmem-open').count();
ok(stillSheet === 0, 'Le glisser n’ouvre pas le panneau');
await P(() => globalThis.permanentMemory.ui.setMoveMode(false));
await setS({ floating: false });
await P(() => globalThis.permanentMemory.ui.refreshAll());

// --- résumé automatique
await setS({ neverAI: false, autoExtract: false, autoSummary: true, summaryEvery: 10, maxCallsPerDay: 10, maxTokensPerMonth: 100000 });
await P(() => { const s = globalThis.permanentMemory; s.store.resetStats(); s.engine.initChatCursors(); const cd = s.store.chatData(true); cd.lastSummaryIdx = SillyTavern.getContext().chat.length - 1; cd.memories = cd.memories.filter((m) => !m.summary); });
await mockClear();
const isSum = (r) => (r.messages || []).some((m) => /tiens le résumé/.test(String(m.content)));
for (let i = 0; i < 4; i++) await say(page, `Message de remplissage numéro ${i + 1} sans intérêt.`);
await sleep(3000);
let log = await mockLog();
ok(log.length === 4 && !log.some(isSum), `8 messages (< 10) : aucun résumé (${log.length} requêtes)`);
await mock({ rules: [{ match: 'tiens le résumé', text: 'Résumé auto : discussion de remplissage.' }] });
await say(page, 'Message cinq.');
await say(page, 'Message six.');
await sleep(4500);
log = await mockLog();
ok(log.filter(isSum).length === 1, `À 10+ messages : exactement 1 appel de résumé (${log.filter(isSum).length})`);
const sm = await P(() => globalThis.permanentMemory.store.chatData(true).memories.filter((m) => m.summary).map((m) => m.text));
ok(sm.length === 1 && sm[0].includes('Résumé auto'), `Résumé stocké comme un seul souvenir (${sm[0]})`);
await setS({ autoSummary: false });
ok(errs.length === 0, `Aucune erreur console (${errs.length})`);
await browser.close();
console.log(process.exitCode ? '\n=== ÉCHECS ===' : '\n=== TOUT EST OK ===');
