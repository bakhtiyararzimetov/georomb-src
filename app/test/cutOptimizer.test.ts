// Раскрой профиля: инварианты всех вариантов, пропил, мин. обрезок, подрезка, остатки склада.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage } from './helpers.ts';
installStorage(); installDom();
const { cutOptimize } = await import('../src/model/cutOptimizer.ts');
import type { CutParams, CutResult, Scrap } from '../src/model/cutOptimizer.ts';

const C: CutParams = { k: 5, minScrap: 140, trimMax: 80 };
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

// каждый вариант: все детали ровно по разу, хлыст не переполнен (Σ + пропилы между деталями ≤ длины),
// остаток склада — не больше одного раза и только из переданных
function checkInvariants(pieces: number[], L: number, k: number, scraps: Scrap[], r: CutResult, P: CutParams = C): void {
  const want = pieces.filter(x => x <= L).sort((a, b) => a - b);
  for(const v of r.variants){
    const got = v.plans.flatMap(p => p.cuts).sort((a, b) => a - b);
    assert.deepEqual(got, want, v.name + ': набор деталей не совпадает');
    const uids = v.plans.filter(p => p.scrap).map(p => p.scrap!.uid);
    assert.equal(new Set(uids).size, uids.length, v.name + ': один остаток склада использован дважды');
    for(const p of v.plans){
      const need = p.cuts.reduce((a, c) => a + c, 0) + k * (p.cuts.length - 1);
      assert.ok(need <= p.len + 1e-9, `${v.name}: хлыст ${p.len} переполнен (${p.cuts.join('+')})`);
      if(p.scrap){
        assert.ok(scraps.some(s => s.uid === p.scrap!.uid && s.len === p.len), 'чужой остаток');
      }
      assert.equal(p.usable, p.left >= P.minScrap);
    }
    assert.equal(v.newBars + v.fromWh, v.plans.length);
  }
  assert.deepEqual(r.tooLong.slice().sort(), pieces.filter(x => x > L).sort());
}

test('случайные наборы: инварианты всех вариантов (без склада, быстрый режим)', () => {
  const rnd = rng(7);
  for(let it = 0; it < 150; it++){
    const n = 1 + Math.floor(rnd() * 30);
    const pieces = Array.from({ length: n }, () => 200 + Math.floor(rnd() * 3000));
    const r = cutOptimize(pieces, 6000, C, [], 0);
    assert.ok(r.variants.length > 0);
    checkInvariants(pieces, 6000, C.k, [], r);
  }
});

test('случайные наборы со складом: остатки не используются дважды', () => {
  const rnd = rng(11);
  for(let it = 0; it < 40; it++){
    const pieces = Array.from({ length: 1 + Math.floor(rnd() * 15) }, () => 300 + Math.floor(rnd() * 1500));
    const scraps: Scrap[] = Array.from({ length: Math.floor(rnd() * 6) }, (_, i) => ({ id: 1, uid: '1.' + i, len: 500 + Math.floor(rnd() * 2500) }));
    const r = cutOptimize(pieces, 6000, C, scraps, 30);
    checkInvariants(pieces, 6000, C.k, scraps, r);
  }
});

test('деталь длиннее хлыста — в tooLong; деталь ровно в хлыст — отдельный хлыст без пропила', () => {
  const r = cutOptimize([6001, 6000, 1000], 6000, C, [], 0);
  assert.deepEqual(r.tooLong, [6001]);
  const v = r.variants[0];
  assert.equal(v.newBars, 2);
  const solo = v.plans.find(p => p.cuts[0] === 6000)!;
  assert.equal(solo.left, 0);
});

test('пропил 0: две детали по 3000 из хлыста 6000', () => {
  assert.equal(cutOptimize([3000, 3000], 6000, { ...C, k: 0 }, [], 0).variants[0].newBars, 1);
});

test('пропил только между деталями (как romchi): 4×1496 = 5984 + 3 пропила = 5999 ≤ 6000 — один хлыст', () => {
  for(const v of cutOptimize([1496, 1496, 1496, 1496], 6000, C, [], 0).variants) assert.equal(v.newBars, 1, v.name);
  assert.equal(cutOptimize([1497, 1497, 1497, 1497], 6000, C, [], 0).variants[0].newBars, 2, '5988 + 15 = 6003 — не влезает');
});

test('пропил между деталями: 3000 + 2995 + пропил = 6000 — один хлыст во всех вариантах', () => {
  for(const v of cutOptimize([3000, 2995], 6000, C, [], 0).variants) assert.equal(v.newBars, 1, v.name);
});

test('дробный пропил 2,5 мм: остаток склада 1050 мм берётся под деталь 1000 мм', () => {
  const scraps: Scrap[] = [{ id: 1, uid: '1.0', len: 1050 }];
  const int = cutOptimize([1000], 6000, { ...C, k: 3 }, scraps, 0).variants[0];
  assert.equal(int.fromWh, 1, 'контроль: при целом пропиле остаток берётся');
  const frac = cutOptimize([1000], 6000, { ...C, k: 2.5 }, scraps, 0).variants[0];
  assert.equal(frac.fromWh, 1);
});

test('дробный пропил 2,5 мм: точные алгоритмы не хуже FFD', () => {
  const r = cutOptimize([1000, 1000, 1000, 1000, 1000], 6000, { ...C, k: 2.5 }, [], 0);
  for(const v of r.variants) assert.equal(v.newBars, 1, v.name + ': ' + v.newBars + ' хлыстов');
});

test('отход и деловой обрезок: остаток ≥ мин. обрезка — деловой, меньше — в отход', () => {
  const v = cutOptimize([5000], 6000, C, [], 0).variants[0];
  assert.equal(v.plans[0].left, 995);
  assert.equal(v.plans[0].usable, true);
  assert.equal(v.wasteMm, 0);
  const w = cutOptimize([5900], 6000, C, [], 0).variants[0];
  assert.equal(w.plans[0].left, 95);
  assert.equal(w.plans[0].usable, false);
  assert.equal(w.wasteMm, 95);
});

test('дробный пропил не замедляет точный подбор (300 деталей, пропил 2,25 мм)', () => {
  const rnd = (i: number) => 300 + ((i * 7919) % 2200);
  const pieces = Array.from({ length: 300 }, (_, i) => rnd(i));
  const t0 = Date.now(); cutOptimize(pieces, 6000, { ...C, k: 3 }, [], 0); const intMs = Date.now() - t0;
  const t1 = Date.now(); const r = cutOptimize(pieces, 6000, { ...C, k: 2.25 }, [], 0); const fracMs = Date.now() - t1;
  assert.ok(fracMs < Math.max(1500, intMs * 3), `дробный пропил: ${fracMs} мс, целый: ${intMs} мс`);
  for(const v of r.variants) for(const p of v.plans) assert.ok(p.cuts.reduce((a, x) => a + x, 0) + 2.25 * (p.cuts.length - 1) <= 6000 + 1e-9, 'хлыст переполнен');
});

test('«Длинная + добор» с дробным пропилом находит точную укладку (3000 + 2995, пропил 2,5)', () => {
  const r = cutOptimize([3000, 2995], 6000, { ...C, k: 2.5 }, [], 0);
  for(const v of r.variants) assert.equal(v.newBars, 1, v.name);
});

// ===== склад — как WarehouseProfileMatcher в romchi: отдельный шаг до раскроя =====
const sc = (len: number, i = 0): Scrap => ({ id: 1, uid: '1.' + i + '.' + len, len });
const whPlans = (r: CutResult) => r.variants[0].plans.filter(p => p.scrap).map(p => [p.len, ...p.cuts]);

test('склад: остаток берётся без правила подрезки (остаток 1000, деталь 900 → хвост 100 в отход)', () => {
  const r = cutOptimize([900], 6000, C, [sc(1000)], 0);
  assert.deepEqual(whPlans(r), [[1000, 900]]);
  assert.equal(r.variants[0].newBars, 0);
});

test('склад: пропил только между деталями (остаток 1000: 497 + 5 + 497 = 999)', () => {
  assert.deepEqual(whPlans(cutOptimize([497, 497], 6000, C, [sc(1000)], 0)), [[1000, 497, 497]]);
});

test('склад: деталь — в остаток, где останется меньше всего (best fit)', () => {
  assert.deepEqual(whPlans(cutOptimize([950], 6000, C, [sc(1500, 1), sc(1000, 2)], 0)), [[1000, 950]]);
});

test('склад: начатый остаток лучше нового, если после детали в нём останется меньше', () => {
  // 600 → остаток A (останется 400); 390 → в A останется 5, в новом B — 610: в A
  assert.deepEqual(whPlans(cutOptimize([600, 390], 6000, C, [sc(1000, 1), sc(1000, 2)], 0)), [[1000, 600, 390]]);
});

test('склад: детали от длинных к коротким, оставшиеся — в новые хлысты', () => {
  const r = cutOptimize([2500, 800, 700], 6000, C, [sc(900)], 0);
  assert.deepEqual(whPlans(r), [[900, 800]], 'длинная 2500 не влезает, 800 — первой из подходящих');
  assert.equal(r.variants[0].newBars, 1);
  assert.deepEqual(r.variants[0].plans.filter(p => !p.scrap).flatMap(p => p.cuts).sort(), [2500, 700].sort());
});

test('склад: все варианты используют одни и те же остатки', () => {
  const r = cutOptimize([1200, 900, 3000, 2000, 450], 6000, C, [sc(1000, 1), sc(1300, 2)], 0);
  const first = JSON.stringify(whPlans(r));
  for(const v of r.variants) assert.equal(JSON.stringify(v.plans.filter(p => p.scrap).map(p => [p.len, ...p.cuts])), first, v.name);
});

// ===== выбор лучшего варианта — как selectTop5 в romchi =====
test('при равных хлыстах и отходе первым — вариант с меньшим числом деловых обрезков', () => {
  // [2900+2900+100 | 3000] — один деловой обрезок; [2900+2900 | 3000+100] — два
  const v = cutOptimize([3000, 2900, 2900, 100], 6000, C, [], 0).variants[0];
  assert.equal(v.newBars, 2);
  assert.equal(v.newScraps, 1);
});

test('результат не зависит от скорости телефона', () => {
  const pieces = Array.from({ length: 60 }, (_, i) => 300 + ((i * 7919) % 2400));
  const fast = cutOptimize(pieces, 6000, C, [], 350).variants.map(v => v.sig);
  const orig = performance.now.bind(performance);
  let t = orig();
  performance.now = () => (t += 50);                 // «медленный телефон»: каждый вызов — +50 мс
  try{
    const slow = cutOptimize(pieces, 6000, C, [], 350).variants.map(v => v.sig);
    assert.deepEqual(slow, fast);
  }finally{ performance.now = orig; }
});
