// Migration 1.0.0 → 1.0.1 : un fichier de stockage ancien (sans appVersion) est relu sans perte + copie de sécurité écrite.
import { boot, ok, ST, sleep } from './lib.mjs';
const { browser, page, errs } = await boot();
const P = (fn, arg) => page.evaluate(fn, arg);
const old = { version: 1, scopes: { 'char:Seraphina.png': { name: 'Seraphina', kind: 'char', memories: [{ id: 'mig01', text: 'Souvenir ancien épinglé de la 1.0.0', type: 'fait', importance: 5, pinned: true, enabled: true, archived: false, created: 1700000000000, uses: 4 }] }, world: { name: 'Monde', kind: 'world', memories: [{ id: 'mig02', text: 'Monde ancien', type: 'lieu', importance: 3 }] } }, candidates: [], rejected: [] };
await P(async (o) => { const c = SillyTavern.getContext(); const b = btoa(unescape(encodeURIComponent(JSON.stringify(o)))); await fetch('/api/files/upload', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ name: 'permanent_memory_store.json', data: b }) }); await fetch('/api/files/delete', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ path: 'user/files/permanent_memory_store_backup_avant_1.0.1.json' }) }); }, old);
await page.reload();
await page.waitForFunction(() => globalThis.permanentMemory?.ready, null, { timeout: 60000 });
await sleep(3000);
const m = await P(() => { const s = globalThis.permanentMemory.store.store; return Object.values(s.scopes).flatMap((x) => x.memories).map((x) => `${x.id}:${x.pinned}:${x.uses}`); });
ok(m.includes('mig01:true:4') && m.some((x) => x.startsWith('mig02')), `Souvenirs de la 1.0.0 conservés (${m})`);
const bk = await fetch(`${ST}user/files/permanent_memory_store_backup_avant_1.0.1.json?t=${Date.now()}`);
ok(bk.ok && JSON.stringify(await bk.json()).includes('mig01'), 'Copie de sécurité permanent_memory_store_backup_avant_1.0.1.json écrite');
const g = await P(() => { const es = SillyTavern.getContext().extensionSettings.permanent_memory; delete es.groupAllMembers; delete es.groupIncludeMuted; es.settingsVersion = 1; es.groupMode = 'speaking'; return globalThis.permanentMemory.settings().groupAllMembers; });
ok(g === true, 'Réglage groupAllMembers = ON après migration des réglages');
ok(errs.length === 0, 'Aucune erreur JS');
await browser.close();
