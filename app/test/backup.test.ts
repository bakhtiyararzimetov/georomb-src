// Импорт резервной копии: старые и битые файлы, лимиты, потеря данных.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage, type MemoryStorage } from './helpers.ts';
let ls: MemoryStorage = installStorage();
const dom = installDom();
const { S } = await import('../src/state.ts');
const { clonePriceDefaults } = await import('../src/model/pricing.ts');
const { loadCuttingSettings } = await import('../src/features/cutting.ts');
const { importProjectsFromFile } = await import('../src/features/backup.ts');
const { withoutHistory, PROJECTS_STORAGE_KEY } = await import('../src/storage.ts');
const { isElementValid } = await import('../src/model/history.ts');
const { applySlidingTemplate } = await import('../src/model/tree.ts');
import type { Project, TreeNode, WinElement } from '../src/types.ts';
console.error = () => {};                      // importProjectsFromFile пишет разбор битых файлов в консоль

beforeEach(() => {
  ls = installStorage();
  S.projects = []; S.nextId = 1; S.nextElemId = 1; S.nextNodeId = 1;
  S.prices = clonePriceDefaults(); S.cutting = loadCuttingSettings();
  S.catalogOff = new Set(); S.warehouseRemnants = [];
  dom.el('toast').textContent = '';
});
const fileInput = (text: string) => ({ value: 'x', files: [{ size: text.length, text: async () => text }] }) as unknown as HTMLInputElement;
const backup = (projects: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'window-projects-backup', version: 1, projects, ...extra }, withoutHistory);
const el = (o: Partial<WinElement> = {}): WinElement => ({ id: 1, type: 'casement', width: 1500, height: 1200, qty: 1, color: null, history: [], redo: [], ...o });
const proj = (elements: WinElement[], o: Partial<Project> = {}): Project => ({ id: 1, number: 1, name: 'Иванов', date: '1 мая', type: 'pvc', elements, ...o });

test('не JSON / чужой формат / пустой список — сообщение, проекты не меняются', async () => {
  for(const t of ['не json', '{"format":"x","projects":[]}', backup([]), 'null', '[]']){
    await importProjectsFromFile(fileInput(t));
    assert.equal(S.projects.length, 0, t);
    assert.ok(dom.toast().length > 0, t);
  }
});

test('старый формат: размеры строками, сдвижной шаблон, подоконник — импортируется без потерь', async () => {
  const sl = el({ id: 2, type: 'sliding', width: '3000', height: '1500' }); applySlidingTemplate(sl, 'sliding_3_a');
  const p = proj([el({ width: '1600', height: '1400', qty: '2', sill: true, sillLen: 1.64, sillWidth: 30 }), sl]);
  await importProjectsFromFile(fileInput(backup([p])));
  assert.equal(S.projects.length, 1);
  const [a, b] = S.projects[0].elements;
  assert.equal(a.width, 1600); assert.equal(a.qty, 2); assert.equal(a.sillWidth, 30);
  assert.equal(b.slidingTemplate, 'sliding_3_a');
  assert.deepEqual(b.root!.dividers, ['cap', 'cap']);
  assert.equal(isElementValid(b, S.projects[0]), true);
});

test('битые элементы пропускаются, остальное импортируется', async () => {
  const bad: unknown[] = [null, 5, { type: 'casement', width: 'abc', height: 1, qty: 1 },
    { type: 'casement', width: 1500, height: 1200, qty: 1, root: { kind: 'branch', children: [{}] } },
    { type: 'casement', width: 1500, height: 1200, qty: 1, root: { kind: 'branch', children: 'x' } }];
  await importProjectsFromFile(fileInput(backup([{ name: 'X', elements: [...bad, el()] }])));
  assert.equal(S.projects[0].elements.length, 1);
  assert.match(dom.toast(), /пропущено элементов: 5/);
});

test('окно с 9 вертикальными полями, созданное в приложении, переживает экспорт → импорт',
  { todo: 'БАГ: cleanNode (backup.ts:94) отбрасывает ветку с >8 детьми, а flattenSameDir/инструмент MV1 собирают цепочку из любого числа импостов — элемент теряется при восстановлении' }, async () => {
  const kids: TreeNode[] = Array.from({ length: 9 }, (_, i) => ({ nid: i + 2, kind: 'leaf', fill: 'glass', opening: null }));
  const wide = el({ width: 5400, height: 2400, root: { nid: 1, kind: 'branch', dir: 'v', sizes: null, children: kids } });
  assert.equal(isElementValid(wide, proj([])), true, 'контроль: в приложении элемент допустим');
  await importProjectsFromFile(fileInput(backup([proj([wide])])));
  assert.equal(S.projects[0].elements.length, 1, dom.toast());
});

test('больше 500 проектов: ни один не теряется молча',
  { todo: 'Важно: IMPORT_MAX_PROJECTS=500 (backup.ts:183) — проекты сверх 500 отбрасываются без предупреждения, тост «Импортировано проектов: 500.»' }, async () => {
  const many = Array.from({ length: 520 }, (_, i) => proj([], { id: i + 1, number: i + 1, name: 'П' + i }));
  await importProjectsFromFile(fileInput(backup(many)));
  assert.ok(S.projects.length === 520 || /520|пропущ/.test(dom.toast()), 'импортировано ' + S.projects.length + ', тост: ' + dom.toast());
});

test('кавычки и & в имени клиента сохраняются',
  { todo: 'Мелочь: safeText вырезает <>&"\'` вместо экранирования при выводе — «ООО "Окна & Двери"» → «ООО Окна  Двери»' }, async () => {
  await importProjectsFromFile(fileInput(backup([proj([], { name: 'ООО "Окна & Двери"', address: "ул. Абая 1'А" })])));
  assert.equal(S.projects[0].name, 'ООО "Окна & Двери"');
});

test('импорт при переполненном хранилище не сообщает об успехе',
  { todo: 'Важно: saveProjects молча падает на квоте, а importProjectsFromFile показывает «Импортировано проектов: N» — после перезапуска их нет' }, async () => {
  ls.quotaBytes = 50;
  await importProjectsFromFile(fileInput(backup([proj([el()])])));
  assert.ok(ls.getItem(PROJECTS_STORAGE_KEY) !== null || !/Импортировано/.test(dom.toast()), 'тост: ' + dom.toast());
});

test('XSS: имя/адрес/цвет из чужого файла не несут разметку', async () => {
  await importProjectsFromFile(fileInput(backup([proj([el({ color: '"><img src=x onerror=alert(1)>' })],
    { name: '<img src=x onerror=alert(1)>', date: '<script>1</script>' })],
    { warehouse: { remnants: [{ color: '<b>x</b>', lengthMm: 1000, qty: 1, role: '<i>' }] } })));
  const p = S.projects[0];
  assert.ok(!/[<>"]/.test(p.name + p.date + p.elements[0].color));
  assert.ok(!/[<>]/.test(S.warehouseRemnants[0].color + S.warehouseRemnants[0].role));
});
