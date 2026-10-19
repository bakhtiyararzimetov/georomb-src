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

// ===== доп. статьи сметы: штапик, уплотнитель, стекло по видам, доплата за цвет, работы, скидка и аванс =====
const line = (r: ReturnType<typeof calcProject>, name: string) => r.lines.find(l => l.name === name);

test('штапик и уплотнитель: строки по длинам из геометрии; без цены — строк нет (старые сметы прежние)', () => {
  S.prices = prices();
  const e = el({});
  assert.equal(line(calcProject(project([e])), 'Штапик'), undefined);
  S.prices.bead = 100; S.prices.seal = 50;
  const g = elementGeometry(e, 'pvc');
  const beadM = g.pieces.bead.reduce((a, x) => a + x, 0) / 1000;
  const sealM = (2 * g.glasses.reduce((a, x) => a + 2 * (x.w + x.h), 0)
    + [...g.pieces.wSash, ...g.pieces.dSash, ...g.pieces.slidSash].reduce((a, x) => a + x, 0)) / 1000;
  const r = calcProject(project([e]));
  assert.equal(line(r, 'Штапик')!.qty, Math.round(beadM * 10) / 10);
  assert.equal(line(r, 'Уплотнитель')!.qty, Math.round(sealM * 10) / 10);
  assert.ok(beadM > 0 && sealM > 0);
  assert.ok(r.items[0].roundedTotal! >= line(r, 'Штапик')!.sum + line(r, 'Уплотнитель')!.sum, 'в цене элемента тоже');
});

test('стекло по видам: своя цена за м²; не задана — общая цена «Стекло»', () => {
  S.prices = prices();                                 // glass = 500
  S.prices.glassByType = { bronze: 900 };
  const r = calcProject(project([el({ id: 1, glass: 'bronze' }), el({ id: 2, glass: 'clear' })]));
  const area = elementGeometry(el({}), 'pvc').glassArea;
  assert.equal(line(r, 'Стекло: Бронзовый')!.price, 900);
  assert.equal(line(r, 'Стекло: Прозрачный')!.price, 500);
  assert.equal(line(r, 'Стекло: Бронзовый')!.qty, Math.round(area * 10) / 10);
  assert.equal(line(r, 'Стекло'), undefined);
  S.prices.glassByType = {};
  assert.ok(line(calcProject(project([el({ glass: 'bronze' })])), 'Стекло'), 'без цен по видам — одна строка, как раньше');
});

test('доплата за цвет: цветной и ламинация — % от профиля отдельной строкой; белый — без доплаты', () => {
  S.prices = prices();
  S.prices.colorPct = { colored: 10, laminated: 30 };
  const profileSum = (r: ReturnType<typeof calcProject>) => ['Рама'].reduce((a, n) => a + (line(r, n)?.sum || 0), 0);
  const white = calcProject(project([el({ color: 'ral9016' })]));
  assert.ok(!white.lines.some(l => l.name.startsWith('Доплата')));
  const choc = calcProject(project([el({ color: 'ral8017' })]));
  assert.equal(line(choc, 'Доплата: цветной профиль, 10%')!.sum, Math.round(profileSum(choc) * 0.1));
  const oak = calcProject(project([el({ color: 'oak_golden' })]));
  assert.equal(line(oak, 'Доплата: ламинация, 30%')!.sum, Math.round(profileSum(oak) * 0.3));
});

test('работы: включаются в проекте; монтаж — м² окон, откосы — 2·высота + ширина, доставка — 1 раз', () => {
  S.prices = prices();
  S.prices.works = { install: 2000, dismantle: 500, slopes: 1000, delivery: 5000 };
  const pr = project([el({ qty: 2 }), el({ id: 2, type: 'sill', width: 1500, height: 200 })]);
  assert.ok(!calcProject(pr).lines.some(l => l.name === 'Монтаж'), 'не включены — строк нет');
  pr.works = { install: true, slopes: true, delivery: true };
  const r = calcProject(pr);
  assert.equal(line(r, 'Монтаж')!.qty, 3.6);            // 1,5 × 1,2 × 2 шт
  assert.equal(line(r, 'Откосы')!.qty, 7.8);            // (2 × 1,2 + 1,5) × 2 шт; подоконник не считается
  assert.equal(line(r, 'Доставка')!.qty, 1);
  assert.equal(line(r, 'Доставка')!.sum, 5000);
  assert.equal(line(r, 'Демонтаж'), undefined);
  const elemSum = r.items.reduce((a, c) => a + (c.roundedTotal || 0), 0);
  assert.ok(elemSum < r.subtotal, 'работы — только в смете проекта, не в цене элемента');
});

test('скидка и аванс: Сумма → Скидка → Налог → Итого → Аванс → Остаток', () => {
  S.prices = prices();                                 // налог 12%
  const pr = project([el({})]);
  const base = calcProject(pr);
  pr.discount = { mode: 'pct', value: 10 };
  pr.advance = 1000;
  const r = calcProject(pr);
  assert.equal(r.subtotal, base.subtotal);
  assert.equal(r.discount, Math.round(base.subtotal * 0.1));
  assert.equal(r.tax, Math.round((base.subtotal - r.discount) * 0.12));
  assert.equal(r.grand, base.subtotal - r.discount + r.tax);
  assert.equal(r.advance, 1000);
  assert.equal(r.due, r.grand - 1000);
  pr.discount = { mode: 'sum', value: 1e12 };
  pr.advance = 1e12;
  const big = calcProject(pr);
  assert.deepEqual([big.grand, big.due], [0, 0], 'скидка и аванс не уводят в минус');
});

test('без новых полей смета такая же, как раньше (итог без скидки = сумма + налог)', () => {
  S.prices = prices();
  const r = calcProject(project([el({})]));
  assert.equal(r.discount, 0);
  assert.equal(r.due, r.grand);
  assert.equal(r.grand, r.subtotal + r.tax);
});
