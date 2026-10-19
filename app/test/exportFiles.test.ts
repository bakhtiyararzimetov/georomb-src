// Экспорт: каждый проект — свой файл с названием проекта; импорт: сразу несколько файлов.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage } from './helpers.ts';
installStorage();
const dom = installDom();
const { S } = await import('../src/state.ts');
const { clonePriceDefaults } = await import('../src/model/pricing.ts');
const { loadCuttingSettings } = await import('../src/features/cutting.ts');
const backup = await import('../src/features/backup.ts');
import type { Project } from '../src/types.ts';
console.error = () => {};

const proj = (id: number, name: string): Project => ({ id, number: id, name, date: '1 мая', type: 'pvc',
  elements: [{ id: id * 10, type: 'casement', width: 1000 + id, height: 1000, qty: 1, color: null, history: [], redo: [] }] });

let written: { path: string; data: string }[] = [], shared: { files?: string[]; url?: string }[] = [];
beforeEach(() => {
  installStorage();
  S.projects = []; S.nextId = 1; S.nextElemId = 1; S.nextNodeId = 1;
  S.prices = clonePriceDefaults(); S.cutting = loadCuttingSettings();
  S.catalogOff = new Set(); S.warehouseRemnants = [];
  dom.el('toast').textContent = '';
  written = []; shared = [];
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, Plugins: {
    Filesystem: { writeFile: async (o: { path: string; data: string }) => { written.push(o); return { uri: 'file:///cache/' + o.path }; } },
    Share: { share: async (o: { files?: string[]; url?: string }) => { shared.push(o); } }
  } };
});
const decode = (b64: string) => JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

test('exportFileNames: название проекта, запрещённые символы заменены, одинаковые — с номером', () => {
  assert.deepEqual(backup.exportFileNames([
    { name: 'Иванов, ул. Навои 12' }, { name: 'А/Б: "окна"' }, { name: 'Иванов, ул. Навои 12' }, { name: '   ' }
  ]), ['Иванов, ул. Навои 12.json', 'А_Б_ _окна_.json', 'Иванов, ул. Навои 12 (2).json', 'Проект.json']);
});

test('экспорт выбранных проектов: по файлу на проект, одним «Поделиться», в каждом — только свой проект', async () => {
  S.projects = [proj(1, 'Иванов'), proj(2, 'Петров'), proj(3, 'Сидоров')];
  backup.openExportPicker();
  backup.toggleExportSelect(1); backup.toggleExportSelect(3);
  await backup.confirmExportSelected();
  assert.deepEqual(written.map(w => w.path.split('/').pop()), ['Иванов.json', 'Сидоров.json']);
  assert.deepEqual(written.map(w => decode(w.data).projects.map((p: Project) => p.name)), [['Иванов'], ['Сидоров']]);
  assert.ok(written.every(w => decode(w.data).licenseCode === undefined), 'код активации в выборочный экспорт не попадает');
  assert.equal(shared.length, 1);
  assert.equal(shared[0].files!.length, 2);
});

test('импорт нескольких файлов сразу: проекты из всех, битый файл назван в сообщении', async () => {
  const file = (name: string, text: string) => ({ name, size: text.length, text: async () => text });
  const ok = (p: Project) => JSON.stringify({ format: 'window-projects-backup', version: 1, projects: [p] });
  const input = { value: 'x', files: [file('Иванов.json', ok(proj(1, 'Иванов'))), file('фото.json', '{oops'), file('Петров.json', ok(proj(2, 'Петров')))] } as unknown as HTMLInputElement;
  await backup.importProjectsFromFile(input);
  assert.deepEqual(S.projects.map(p => p.name).sort(), ['Иванов', 'Петров']);
  assert.match(dom.toast(), /Импортировано проектов: 2/);
  assert.match(dom.toast(), /фото\.json/);
});

test('импорт одного файла — сообщение как раньше', async () => {
  const text = JSON.stringify({ format: 'window-projects-backup', version: 1, projects: [proj(1, 'Иванов')] });
  await backup.importProjectsFromFile({ value: 'x', files: [{ name: 'Иванов.json', size: text.length, text: async () => text }] } as unknown as HTMLInputElement);
  assert.equal(dom.toast(), 'Импортировано проектов: 1.');
});
