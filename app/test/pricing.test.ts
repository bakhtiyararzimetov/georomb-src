// Смета: длины деталей, итоги, отдельный подоконник, недопустимая геометрия.
// Тесты с { todo: 'БАГ …' } демонстрируют найденную ошибку: они падают, но не ломают `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage } from './helpers.ts';
installStorage(); installDom();
const { S } = await import('../src/state.ts');
const { calcElement, calcProject, clonePriceDefaults, elementGeometry } = await import('../src/model/pricing.ts');
const { computeLayout } = await import('../src/model/layout.ts');
const { isElementValid } = await import('../src/model/history.ts');
import type { Project, WinElement } from '../src/types.ts';

const project = (elements: WinElement[], type: 'pvc' | 'alu' = 'pvc'): Project => ({ id: 1, name: 'T', date: '', type, elements });
const el = (o: Partial<WinElement>): WinElement => ({ id: 1, type: 'casement', width: 1500, height: 1200, qty: 1, color: null, history: [], redo: [], ...o });
const threeSashes = (width: number): WinElement => el({ width, root: { nid: 1, kind: 'branch', dir: 'v', sizes: null, children: [
  { nid: 2, kind: 'leaf', fill: 'glass', opening: { type: 'Turn', hinge: 'left' } },
  { nid: 3, kind: 'leaf', fill: 'glass', opening: { type: 'Turn', hinge: 'left' } },
  { nid: 4, kind: 'leaf', fill: 'glass', opening: { type: 'Turn', hinge: 'right' } }] } });

function prices() {
  const p = clonePriceDefaults();
  p.profile.pvc.frame = 1000; p.profile.pvc.mullion = 800; p.profile.pvc.wSash = 900;
  p.glass = 500; p.accessory.Turn = 3000; p.tax = 12;
  for(const w of Object.keys(p.sill)) p.sill[Number(w)] = 2000;
  return p;
}

test('рама ПВХ 1500×1200: 4 детали с припуском на сварку 2×3 мм', () => {
  S.prices = prices();
  const g = elementGeometry(el({}), 'pvc');
  assert.deepEqual(g.pieces.frame, [1506, 1506, 1206, 1206]);
  assert.equal(g.frameLen, (2 * (1500 + 1200) + 4 * 6) / 1000);
  // глухое стекло: внутренний проём минус 2·glassGap
  assert.deepEqual(g.glasses, [{ w: 1500 - 90 - 10, h: 1200 - 90 - 10 }]);
});

test('итог сметы = сумма строк + налог; количество умножается на qty', () => {
  S.prices = prices();
  const p = project([threeSashes(1800), el({ id: 2, qty: 3 })]);
  const r = calcProject(p);
  const sum = r.lines.reduce((a, l) => a + l.sum, 0);
  assert.equal(r.subtotal, sum);
  assert.equal(r.tax, Math.round(sum * 0.12));
  assert.equal(r.grand, r.subtotal + r.tax);
  const acc = r.lines.find(l => l.name === 'Поворот')!;
  assert.equal(acc.qty, 3);
  assert.equal(acc.sum, 9000);
  assert.equal(r.totals.qty, 4);
});

test('отходы «процент»: строка отходов = процент от суммы строк профиля', () => {
  S.prices = prices();
  S.prices.waste = { mode: 'percent', percent: 10 };
  const r = calcProject(project([el({})]));
  const frame = r.lines.find(l => l.name === 'Рама')!;
  const waste = r.lines.find(l => l.name.startsWith('Отходы профиля'))!;
  assert.equal(waste.sum, Math.round(frame.sum * 0.1));
});

test('отдельный подоконник (type=sill) считается как подоконник, а не как рама со стеклом', () => {
  S.prices = prices();
  const sill = el({ type: 'sill', width: 1500, height: 200 });
  const r = calcProject(project([sill]));
  const names = r.lines.map(l => l.name);
  assert.ok(!names.includes('Рама'), 'в смете отдельного подоконника есть строка «Рама»: ' + JSON.stringify(r.lines));
  assert.ok(!names.includes('Стекло'), 'в смете отдельного подоконника есть строка «Стекло»');
  assert.ok(names.some(n => n.startsWith('Подоконник')), 'нет строки «Подоконник»');
  const line = r.lines.find(l => l.name === 'Подоконник, 20 см')!;
  assert.equal(line.qty, 1.5, 'длина 1500 мм, полка 200 мм = 20 см');
  assert.equal(r.grand, Math.round(1.5 * 2000 * 1.12), 'только подоконник и налог');
  assert.equal(r.totals.area, 0, 'подоконник не добавляет площадь окон');
});

test('отдельный подоконник с нестандартной глубиной — ближайшая ширина полки из прайса', () => {
  S.prices = prices();
  const r = calcProject(project([el({ type: 'sill', width: 1000, height: 270 })]));
  assert.ok(r.lines.some(l => l.name === 'Подоконник, 25 см' || l.name === 'Подоконник, 30 см'), JSON.stringify(r.lines.map(l => l.name)));
});

test('ширина "1500,5" (запятая) не обрезается до 1500', () => {
  assert.equal(computeLayout(el({ width: '1500,5' })).W, 1500.5);
});

test('ширина 0 из повреждённых данных считается как 1500 — окно видно и его можно исправить (решение владельца)', () => {
  S.prices = prices();
  assert.equal(elementGeometry(el({ width: 0 }), 'pvc').W, 1500);
});

test('количество 0 не считается как 1 шт', () => {
  S.prices = prices();
  assert.equal(calcElement(el({ qty: 0 }), project([])).qty, 0);
});

test('отходы «по полной длине»: неизвестный код цвета — та же группа, что «без цвета» (как в раскрое)', () => {
  S.prices = prices();
  S.prices.waste = { mode: 'full', percent: 0 };
  const small = (id: number, color: string | null) => el({ id, color, width: 300, height: 300 });
  const a = calcProject(project([small(1, null), small(2, null), small(3, null), small(4, null)]));
  const b = calcProject(project([small(1, null), small(2, null), small(3, 'нет-такого'), small(4, 'нет-такого')]));
  assert.equal(a.waste!.bars, 1, 'контроль: рамы четырёх окон 300×300 — один хлыст');
  assert.equal(b.waste!.bars, a.waste!.bars);
});

test('pieceCount: одно правило количества для раскроя, стекла и отходов', async () => {
  const { pieceCount } = await import('../src/model/pricing.ts');
  assert.deepEqual([0, 0.4, 1, 2.5, 3, '2', '', 'x', -1].map(pieceCount), [0, 1, 1, 3, 3, 2, 1, 1, 0]);
});
