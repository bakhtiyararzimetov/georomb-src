// Раскрой стекла на листах: без наложений, в пределах листа за вычетом кромки, рез между стёклами.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetCut } from '../src/model/sheetCut.ts';
import type { SheetParams, SheetPiece } from '../src/model/sheetCut.ts';

function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

function check(pieces: SheetPiece[], P: SheetParams): void {
  const r = sheetCut(pieces, P);
  let placed = 0;
  for(const s of r.sheets){
    placed += s.placed.length;
    for(const a of s.placed){
      assert.ok(a.x >= P.edge && a.y >= P.edge && a.x + a.w <= P.sheetW - P.edge && a.y + a.h <= P.sheetH - P.edge, 'выход за кромку');
      const src = pieces.find(p => p.label === a.label)!;
      assert.deepEqual(a.rot ? [a.h, a.w] : [a.w, a.h], [src.w, src.h], 'размер стекла изменился');
      if(a.rot) assert.ok(P.rotate, 'поворот при запрете поворота');
      for(const b of s.placed){
        if(a === b) continue;
        const apart = a.x + a.w + P.gap <= b.x + 1e-9 || b.x + b.w + P.gap <= a.x + 1e-9
                   || a.y + a.h + P.gap <= b.y + 1e-9 || b.y + b.h + P.gap <= a.y + 1e-9;
        assert.ok(apart, `наложение/нет реза: ${a.label} и ${b.label}`);
      }
    }
  }
  assert.equal(placed + r.tooBig.length, pieces.length, 'стекло потерялось или повторилось');
}

test('случайные наборы: без наложений и с резом между стёклами', () => {
  const rnd = rng(3);
  for(let it = 0; it < 120; it++){
    const n = 1 + Math.floor(rnd() * 25);
    const pieces = Array.from({ length: n }, (_, i) => ({ w: 50 + Math.floor(rnd() * 2400), h: 50 + Math.floor(rnd() * 1800), label: 'p' + i }));
    check(pieces, { sheetW: 3210, sheetH: 2250, edge: Math.floor(rnd() * 20), gap: Math.floor(rnd() * 6), rotate: rnd() < 0.5 });
  }
});

test('стекло во весь лист без кромки помещается ровно; на 1 мм больше — в tooBig', () => {
  const P = { sheetW: 3210, sheetH: 2250, edge: 10, gap: 3, rotate: false };
  assert.equal(sheetCut([{ w: 3190, h: 2230, label: 'a' }], P).sheets.length, 1);
  assert.equal(sheetCut([{ w: 3191, h: 2230, label: 'a' }], P).tooBig.length, 1);
  // с поворотом высокое стекло ложится боком
  assert.equal(sheetCut([{ w: 2230, h: 3190, label: 'a' }], { ...P, rotate: true }).tooBig.length, 0);
});

test('два стекла по половине листа: рез между ними учитывается', () => {
  const P = { sheetW: 2000, sheetH: 1000, edge: 0, gap: 4, rotate: false };
  assert.equal(sheetCut([{ w: 998, h: 1000, label: 'a' }, { w: 998, h: 1000, label: 'b' }], P).sheets.length, 1);
  assert.equal(sheetCut([{ w: 999, h: 1000, label: 'a' }, { w: 999, h: 1000, label: 'b' }], P).sheets.length, 2);
});
