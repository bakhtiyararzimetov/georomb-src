// Раскрой стекла на листах (двумерный, гильотинный). Чистая логика, без DOM.
//   • стекло режут только сквозными резами от края до края куска, поэтому раскладка гильотинная:
//     после каждой детали свободный кусок делится одним прямым резом на два;
//   • кромка листа срезается с каждой стороны (edge), между стёклами — рез (gap);
//   • несколько порядков деталей × правил выбора места × правил деления, лучший результат:
//     меньше листов → на последнем листе занято меньше (крупный остаток).

export interface SheetPiece { w: number; h: number; label: string; }
export interface Placed { x: number; y: number; w: number; h: number; rot: boolean; label: string; }
export interface Sheet { placed: Placed[]; usedArea: number; }
export interface SheetParams { sheetW: number; sheetH: number; edge: number; gap: number; rotate: boolean; }
export interface SheetResult {
  sheets: Sheet[]; tooBig: SheetPiece[];
  sheetArea: number;      // площадь одного листа, мм²
  usedArea: number;       // сумма площадей стёкол, мм²
  usePct: number;         // доля листов, ушедшая в стекло
}

interface Free { x: number; y: number; w: number; h: number; }
interface Bin { free: Free[]; placed: Placed[]; used: number; }
type Fit = 'area' | 'short' | 'long';
type Split = 'shorter' | 'longer' | 'bigRest';

/** Сколько места занимает деталь на листе с учётом реза и как её положить. */
function fitScore(f: Free, w: number, h: number, fit: Fit): number {
  const dw = f.w - w, dh = f.h - h;
  if(dw < 0 || dh < 0) return Infinity;
  if(fit === 'area') return f.w * f.h - w * h;
  if(fit === 'short') return Math.min(dw, dh);
  return Math.max(dw, dh);
}
// деление свободного куска после того, как в его левый верхний угол легла деталь w×h
function splitFree(f: Free, w: number, h: number, rule: Split): Free[] {
  const dw = f.w - w, dh = f.h - h;
  let horiz: boolean;   // true — рез по горизонтали: правый кусок высотой h, нижний — на всю ширину
  if(rule === 'shorter') horiz = dw <= dh;
  else if(rule === 'longer') horiz = dw > dh;
  else horiz = Math.max(dw * h, f.w * dh) >= Math.max(dw * f.h, w * dh);   // bigRest — оставить самый крупный кусок
  const right: Free = horiz ? { x:f.x + w, y:f.y, w:dw, h } : { x:f.x + w, y:f.y, w:dw, h:f.h };
  const bottom: Free = horiz ? { x:f.x, y:f.y + h, w:f.w, h:dh } : { x:f.x, y:f.y + h, w, h:dh };
  return [right, bottom].filter(r => r.w > 0 && r.h > 0);
}

function pack(order: SheetPiece[], P: SheetParams, fit: Fit, split: Split): Bin[] {
  // рабочее поле: лист без кромок; к нему и к каждой детали прибавлен рез — так рез после последней детали не мешает
  const UW = P.sheetW - 2 * P.edge + P.gap, UH = P.sheetH - 2 * P.edge + P.gap;
  const bins: Bin[] = [];
  const newBin = (): Bin => { const b: Bin = { free:[{ x:0, y:0, w:UW, h:UH }], placed:[], used:0 }; bins.push(b); return b; };
  for(const p of order){
    const opts: [number, number, boolean][] = [[p.w + P.gap, p.h + P.gap, false]];
    if(P.rotate && p.w !== p.h) opts.push([p.h + P.gap, p.w + P.gap, true]);
    let best: { b: Bin; fi: number; w: number; h: number; rot: boolean; s: number } | null = null;
    // сначала — уже начатые листы, лист берётся новый только если деталь никуда не легла
    for(const b of bins){
      b.free.forEach((f, fi) => opts.forEach(([w, h, rot]) => {
        const s = fitScore(f, w, h, fit);
        if(s < Infinity && (!best || s < best.s)) best = { b, fi, w, h, rot, s };
      }));
    }
    if(!best){
      const b = newBin();
      opts.forEach(([w, h, rot]) => {
        const s = fitScore(b.free[0], w, h, fit);
        if(s < Infinity && (!best || s < best.s)) best = { b, fi:0, w, h, rot, s };
      });
      if(!best) continue;   // не влезает (проверено заранее, сюда не попадаем)
    }
    const { b, fi, w, h, rot } = best as { b: Bin; fi: number; w: number; h: number; rot: boolean };
    const f = b.free[fi];
    b.free.splice(fi, 1, ...splitFree(f, w, h, split));
    b.placed.push({ x:f.x + P.edge, y:f.y + P.edge, w:w - P.gap, h:h - P.gap, rot, label:p.label });
    b.used += p.w * p.h;
  }
  return bins;
}

const ORDERS: [string, (a: SheetPiece, b: SheetPiece) => number][] = [
  ['area',  (a, b) => b.w * b.h - a.w * a.h],
  ['side',  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h],
  ['perim', (a, b) => (b.w + b.h) - (a.w + a.h)],
  ['width', (a, b) => b.w - a.w || b.h - a.h],
  ['height',(a, b) => b.h - a.h || b.w - a.w]
];

export function sheetCut(pieces: SheetPiece[], P: SheetParams): SheetResult {
  const UW = P.sheetW - 2 * P.edge, UH = P.sheetH - 2 * P.edge;
  const fits = (p: SheetPiece) => (p.w <= UW && p.h <= UH) || (P.rotate && p.h <= UW && p.w <= UH);
  const ok = pieces.filter(fits), tooBig = pieces.filter(p => !fits(p));
  let best: Bin[] | null = null;
  const score = (bins: Bin[]) => bins.length * 1e15 + (bins.length ? bins[bins.length - 1].used : 0);
  for(const [, cmp] of ORDERS){
    const order = ok.slice().sort(cmp);
    for(const fit of ['area', 'short', 'long'] as Fit[]){
      for(const split of ['shorter', 'longer', 'bigRest'] as Split[]){
        const bins = pack(order, P, fit, split);
        if(!best || score(bins) < score(best)) best = bins;
      }
    }
  }
  const bins = best || [];
  // самый пустой лист — в конец (его остаток крупнее всего)
  bins.sort((a, b) => b.used - a.used);
  const sheetArea = P.sheetW * P.sheetH;
  const usedArea = bins.reduce((a, b) => a + b.used, 0);
  return {
    sheets: bins.map(b => ({ placed:b.placed, usedArea:b.used })),
    tooBig, sheetArea, usedArea,
    usePct: bins.length ? usedArea / (bins.length * sheetArea) * 100 : 0
  };
}
