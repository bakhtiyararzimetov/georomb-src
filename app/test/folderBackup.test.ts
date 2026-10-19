// «Восстановить из копии» через выбор папки (Android, плагин FolderAccess): берётся самая свежая копия.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage } from './helpers.ts';
installStorage();
const dom = installDom();
const { S } = await import('../src/state.ts');
const { clonePriceDefaults } = await import('../src/model/pricing.ts');
const { loadCuttingSettings } = await import('../src/features/cutting.ts');
const { restoreFromCopy } = await import('../src/features/backup.ts');
console.error = () => {};

const backupOf = (name: string) => JSON.stringify({ format: 'window-projects-backup', version: 1,
  projects: [{ id: 1, number: 1, name, date: '1 мая', type: 'pvc', elements: [] }] });

let reads: string[] = [];
function nativeWith(fa: object | null): void {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, Plugins: fa ? { FolderAccess: fa } : {} };
}
const folder = (files: Record<string, [number, string]>, picked: Promise<{ uri: string; name: string }> = Promise.resolve({ uri: 'content://tree/GeoRomb', name: 'GeoRomb' })) => ({
  pick: () => picked,
  current: async () => ({ uri: null, name: null }),
  list: async () => ({ files: Object.entries(files).map(([name, [modified]]) => ({ name, modified })) }),
  read: async (o: { name: string }) => { reads.push(o.name); return { data: files[o.name][1] }; },
  write: async () => {}, remove: async () => {}
});

beforeEach(() => {
  installStorage();
  S.projects = []; S.nextId = 1; S.nextElemId = 1; S.nextNodeId = 1;
  S.prices = clonePriceDefaults(); S.cutting = loadCuttingSettings();
  S.catalogOff = new Set(); S.warehouseRemnants = [];
  dom.el('toast').textContent = '';
  reads = [];
});

test('папка выбрана — импортируется только самая свежая копия', async () => {
  nativeWith(folder({
    'georomb-backup-2026-10-17-AB3D.json': [100, backupOf('Старый')],
    'georomb-backup-2026-10-19-QW7E.json': [300, backupOf('Свежий')],
    'фото.jpg': [999, '']
  }));
  await restoreFromCopy();
  assert.deepEqual(reads, ['georomb-backup-2026-10-19-QW7E.json']);
  assert.deepEqual(S.projects.map(p => p.name), ['Свежий']);
  assert.match(dom.toast(), /Импортировано проектов: 1/);
});

test('самая свежая копия испорчена — берётся предыдущая', async () => {
  nativeWith(folder({
    'georomb-backup-2026-10-18-AB3D.json': [200, backupOf('Вчерашний')],
    'georomb-backup-2026-10-19-AB3D.json': [300, '{"format":"window-projects-backup","projects":[{"na']
  }));
  await restoreFromCopy();
  assert.deepEqual(reads, ['georomb-backup-2026-10-19-AB3D.json', 'georomb-backup-2026-10-18-AB3D.json']);
  assert.deepEqual(S.projects.map(p => p.name), ['Вчерашний']);
});

test('двойное нажатие — второй выбор папки не открывается, пока идёт первый', async () => {
  let picks = 0, done!: (v: { uri: string; name: string }) => void;
  const f = folder({ 'georomb-backup-2026-10-19-AB3D.json': [1, backupOf('Один')] }, new Promise(r => { done = r; }));
  nativeWith({ ...f, pick: () => { picks++; return f.pick(); } });
  const a = restoreFromCopy(), b = restoreFromCopy();
  done({ uri: 'u', name: 'GeoRomb' });
  await a; await b;
  assert.equal(picks, 1);
  assert.equal(S.projects.length, 1);
});

test('в папке нет копий — понятное сообщение, проекты не меняются', async () => {
  nativeWith(folder({ 'фото.jpg': [1, ''] }));
  await restoreFromCopy();
  assert.equal(S.projects.length, 0);
  assert.match(dom.toast(), /нет копий/i);
  assert.match(dom.toast(), /GeoRomb/);
});

test('выбор папки отменён — ничего не происходит', async () => {
  nativeWith(folder({}, Promise.reject(new Error('cancelled'))));
  await restoreFromCopy();
  assert.equal(S.projects.length, 0);
  assert.equal(dom.toast(), '');
});

test('без плагина (браузер, старая сборка) — обычный выбор файла', async () => {
  nativeWith(null);
  let clicked = false;
  dom.el('importFile').click = () => { clicked = true; };
  await restoreFromCopy();
  assert.ok(clicked);
});
