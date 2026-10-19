// Проверка JSON от бота: всё, что не нарисовать, — ProjectError (→ 400), а не падение при отрисовке.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProjectError, parseProject } from '../src/project.ts';

const example = (): any => JSON.parse(readFileSync(new URL('../examples/project.json', import.meta.url), 'utf8'));
const leaf = () => ({ kind: 'leaf', fill: 'glass' });
const withElement = (el: object) => ({ elements: [{ width: 1000, height: 1000, ...el }] });

test('пример из server/examples разбирается и получает значения по умолчанию', () => {
  const p = parseProject(example());
  assert.equal(p.elements.length, 2);
  assert.equal(p.name, 'Иванов, ул. Навои 12');
  assert.deepEqual(p.elements.map(e => e.qty), [2, 1]);
  const nids = [p.elements[0].root!.nid, ...p.elements[0].root!.children!.map(c => c.nid)];
  assert.equal(new Set(nids).size, 3, 'узлы перенумерованы');
  assert.deepEqual(p.elements[0].history, []);
});

test('минимальный проект: имя и тип по умолчанию, элемент без root — одно стекло', () => {
  const p = parseProject({ elements: [{ width: 1200, height: 1400 }] });
  assert.equal(p.name, 'Проект');
  assert.equal(p.elements[0].type, 'casement');
  assert.equal(p.elements[0].root!.kind, 'leaf');
});

const bad: [string, unknown, RegExp][] = [
  ['не объект', [1, 2], /объект/],
  ['нет elements', { name: 'x' }, /elements/],
  ['пустой elements', { elements: [] }, /elements/],
  ['51 элемент', { elements: Array.from({ length: 51 }, () => ({ width: 1000, height: 1000 })) }, /50/],
  ['ширина меньше 100', withElement({ width: 50 }), /элемент 1.*ширина/i],
  ['ширина не число', withElement({ width: 'abc' }), /ширина/i],
  ['высота больше 10000', withElement({ height: 20000 }), /высота/i],
  ['неизвестный тип элемента', withElement({ type: 'roof' }), /type/],
  ['неизвестный тип открывания', withElement({ root: { kind: 'leaf', opening: { type: 'Fly', hinge: 'left' } } }), /opening/],
  ['ветка без children', withElement({ root: { kind: 'branch', dir: 'v' } }), /children/],
  ['ветка с неверным dir', withElement({ root: { kind: 'branch', dir: 'x', children: [leaf(), leaf()] } }), /dir/],
  ['sizes не совпадает с children', withElement({ root: { kind: 'branch', dir: 'v', sizes: [500], children: [leaf(), leaf()] } }), /sizes/],
  ['501 узел', withElement({ root: { kind: 'branch', dir: 'v', children: Array.from({ length: 500 }, leaf) } }), /500/],
  ['глубина 21', withElement({ root: Array.from({ length: 20 }).reduce<object>(acc => ({ kind: 'branch', dir: 'v', children: [acc, leaf()] }), leaf()) }), /глубин/i],
  ['неизвестный цвет рамы', withElement({ color: 'pink' }), /элемент 1.*color.*ral9016/i],
  ['цвет алюминия у ПВХ', withElement({ color: 'euras_c0' }), /color/],
  ['неизвестное стекло', withElement({ glass: 'mirror' }), /элемент 1.*glass.*clear/i],
  ['неизвестный цвет проекта', { defaultColor: 'pink', elements: [{ width: 1000, height: 1000 }] }, /defaultColor/],
  ['нулевая квота — элемент не нарисовать', withElement({ root: { kind: 'branch', dir: 'v', sizes: [0, 1000], children: [leaf(), leaf()] } }), /элемент 1/i]
];
for(const [name, body, msg] of bad){
  test('400: ' + name, () => {
    assert.throws(() => parseProject(body), (err: unknown) => err instanceof ProjectError && msg.test(err.message));
  });
}

test('отдельный подоконник с sill:true — прикреплённый подоконник игнорируется', () => {
  const p = parseProject({ elements: [{ type: 'sill', width: 1500, height: 200, sill: true, sillLen: 1.6 }] });
  assert.ok(!p.elements[0].sill);
});

test('коды цвета и стекла из каталога принимаются; у алюминия — свои цвета', () => {
  const p = parseProject({ elements: [{ width: 1000, height: 1000, color: 'oak_golden', glass: 'bronze' }] });
  assert.deepEqual([p.elements[0].color, p.elements[0].glass], ['oak_golden', 'bronze']);
  assert.equal(parseProject({ type: 'alu', elements: [{ width: 1000, height: 1000, color: 'euras_c0' }] }).elements[0].color, 'euras_c0');
  assert.equal(parseProject({ defaultColor: 'ral7016', defaultGlass: 'grey', elements: [{ width: 1000, height: 1000 }] }).defaultColor, 'ral7016');
});

test('подоконник у окна без длины — ширина окна + 2 × 20 мм и полка 20 см, как в приложении', () => {
  const e = parseProject({ elements: [{ width: 1500, height: 1200, sill: true }] }).elements[0];
  assert.deepEqual([e.sill, e.sillLen, e.sillWidth], [true, 1.54, 20]);
  const own = parseProject({ elements: [{ width: 1500, height: 1200, sill: true, sillLen: 1.7, sillWidth: 30 }] }).elements[0];
  assert.deepEqual([own.sillLen, own.sillWidth], [1.7, 30]);
});
