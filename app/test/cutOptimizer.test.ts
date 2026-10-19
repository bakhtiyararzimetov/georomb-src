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
        // подрезка: хвост остатка либо ≤ trimMax (в отход), либо ≥ мин. обрезка
        const tail = p.len - p.cuts.reduce((a, c) => a + c + k, 0);
        assert.ok(tail <= P.trimMax || tail >= P.minScrap, `${v.name}: хвост остатка ${tail} мм между подрезкой и мин. обрезком`);
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

test('случайные наборы со складом: остатки не используются дважды, подрезка соблюдена', () => {
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

test('пропил 5: 4×1496 = 5984 + 3 пропила = 5999 ≤ 6000 — один хлыст',
  { todo: 'БАГ: упаковка считает пропил ПОСЛЕ последней детали (len + k ≤ L), хотя cutBinStats и описание модуля его не считают — лишний хлыст' }, () => {
  const r = cutOptimize([1496, 1496, 1496, 1496], 6000, C, [], 0);
  assert.equal(r.variants[0].newBars, 1);
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
