// Запуск с повреждённым/частично битым localStorage и переполнение хранилища.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage, type MemoryStorage } from './helpers.ts';
let ls: MemoryStorage = installStorage();
const dom = installDom();
const { S } = await import('../src/state.ts');
const { loadProjects, saveProjects, PROJECTS_STORAGE_KEY } = await import('../src/storage.ts');
const { clonePriceDefaults, loadPriceSettings } = await import('../src/model/pricing.ts');
const projects = await import('../src/features/projects.ts');
import type { Project } from '../src/types.ts';

const DEMO = JSON.parse(JSON.stringify(S.projects)) as Project[];
const good = (id: number, name = 'Клиент ' + id): Project => ({ id, name, date: '1 мая', type: 'pvc', elements: [
  { id: id * 10, type: 'casement', width: 1500, height: 1200, qty: 1, color: null, history: [], redo: [] }] });
beforeEach(() => {
  ls = installStorage();
  S.projects = JSON.parse(JSON.stringify(DEMO)) as Project[];
  S.nextId = 4; S.nextElemId = 1; S.nextNodeId = 1;
  S.prices = clonePriceDefaults();
});

test('нормальная загрузка: проекты, nextId/nextElemId не меньше существующих', () => {
  ls.setItem(PROJECTS_STORAGE_KEY, JSON.stringify({ projects: [good(5), good(9)], nextId: 2, nextElemId: 1 }));
  loadProjects();
  assert.deepEqual(S.projects.map(p => p.id), [5, 9]);
  assert.equal(S.nextId, 10);
  assert.equal(S.nextElemId, 91);
});

test('битый JSON: приложение стартует на проектах по умолчанию', () => {
  ls.setItem(PROJECTS_STORAGE_KEY, '{"projects":[{"id":1,');
  assert.doesNotThrow(() => loadProjects());
  assert.equal(S.projects.length, DEMO.length);
});

test('битый JSON не затирается при следующем сохранении', () => {
  const raw = '{"projects":[' + JSON.stringify(good(5)) + ',{"id":6,"name":"обрыв';
  ls.setItem(PROJECTS_STORAGE_KEY, raw);
  loadProjects();
  saveProjects();
  const kept = [...ls.data.values()].some(v => v === raw);
  assert.ok(kept, 'исходная (повреждённая) копия нигде не сохранена');
});

test('один проект без id не уничтожает все остальные', () => {
  ls.setItem(PROJECTS_STORAGE_KEY, JSON.stringify({ projects: [good(5), good(6), { name: 'без id', elements: [] }], nextId: 7 }));
  loadProjects();
  assert.ok(S.projects.some(p => p.id === 5) && S.projects.some(p => p.id === 6), 'загружено: ' + S.projects.map(p => p.name).join(', '));
});

test('проект без имени не роняет список проектов при запуске', () => {
  ls.setItem(PROJECTS_STORAGE_KEY, JSON.stringify({ projects: [{ id: 5, date: '', elements: [] }] }));
  loadProjects();
  assert.doesNotThrow(() => projects.render(''));
});

test('битые настройки цен: дефолты', () => {
  ls.setItem('iwd.priceSettings.v2', '{oops');
  assert.deepEqual(loadPriceSettings(), clonePriceDefaults());
});

test('переполнение localStorage: пользователь узнаёт, что проект не сохранён', () => {
  ls.quotaBytes = 100;
  S.projects = [good(1)];
  saveProjects();
  assert.notEqual(dom.toast(), '', 'никакого сообщения об ошибке сохранения');
});

test('восстановленный проект без номера не получает чужой номер', () => {
  ls.setItem(PROJECTS_STORAGE_KEY, JSON.stringify({ projects: [{ ...good(5), number: 6 }, good(6)] }));
  loadProjects();
  const nums = S.projects.map(p => p.number);
  assert.equal(new Set(nums).size, nums.length, 'номера: ' + nums.join(', '));
});

test('повреждённая копия: сохраняется первая, следующая поломка её не затирает', () => {
  const first = '{"projects":[' + JSON.stringify(good(5)) + ',{"id":6,"name":"обрыв';
  ls.setItem(PROJECTS_STORAGE_KEY, first);
  loadProjects(); saveProjects();
  ls.setItem(PROJECTS_STORAGE_KEY, '{"projects":[{"id":');
  loadProjects();
  assert.equal(ls.getItem('iwd.projects.corrupt.v1'), first);
});
