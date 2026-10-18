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

test('отдельный подоконник (type=sill) считается как подоконник, а не как рама со стеклом',
  { todo: 'БАГ: elementGeometry не различает type=sill — в смету идут «Рама» и «Стекло», подоконник не считается' }, () => {
  S.prices = prices();
  const sill = el({ type: 'sill', width: 1500, height: 200 });
  const r = calcProject(project([sill]));
  const names = r.lines.map(l => l.name);
  assert.ok(!names.includes('Рама'), 'в смете отдельного подоконника есть строка «Рама»: ' + JSON.stringify(r.lines));
  assert.ok(!names.includes('Стекло'), 'в смете отдельного подоконника есть строка «Стекло»');
  assert.ok(names.some(n => n.startsWith('Подоконник')), 'нет строки «Подоконник»');
});

test('недопустимая геометрия (3 створки в 150 мм) не должна давать «нормальную» цену',
  { todo: 'БАГ: calcElement молча считает деталь створки 5 мм; форма правки (saveEditElement) пропускает такой размер без isElementValid' }, () => {
  S.prices = prices();
  const e = threeSashes(150);
  assert.equal(isElementValid(e, project([])), false);
  const c = calcElement(e, project([]));
  assert.ok(c.g.pieces.wSash.every(x => x >= 100), 'детали створки: ' + c.g.pieces.wSash.join(', '));
});

test('ширина "1500,5" (запятая) не обрезается до 1500',
  { todo: 'Мелочь: computeLayout разбирает размер через parseFloat — "1500,5" → 1500, "0"/"abc" → 1500 по умолчанию' }, () => {
  assert.equal(computeLayout(el({ width: '1500,5' })).W, 1500.5);
});

test('ширина 0 не превращается молча в 1500', { todo: 'Мелочь: parseFloat(...) || DEFAULT_W — нулевой/битый размер считается как 1500 мм' }, () => {
  S.prices = prices();
  assert.notEqual(elementGeometry(el({ width: 0 }), 'pvc').W, 1500);
});

test('количество 0 не считается как 1 шт', { todo: 'Мелочь: calcElement: parseFloat(qty) || 1 — qty=0 в смете = 1 шт (из формы 0 не пройдёт, из старых данных — да)' }, () => {
  S.prices = prices();
  assert.equal(calcElement(el({ qty: 0 }), project([])).qty, 0);
});
