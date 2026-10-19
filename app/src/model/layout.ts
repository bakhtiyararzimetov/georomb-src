// Раскладка дерева в миллиметрах — общая для чертежа и сметы.
import { DEFAULT_H, DEFAULT_W } from '../state.ts';
import type { Ext, Layout, MullionRect, Profile, Project, Quad, Rect, SubLayout, TreeNode, WinElement } from '../types.ts';
import {
  SLIDING_GAP, SLIDING_PROFILE, profileFor, sashBand, sashOverhang, visualProfile
} from '../data/profiles.ts';
import { ensureRoot, flattenSameDir } from './tree.ts';

/** Размер или количество из данных: число или строка, запятая — дробная часть («1500,5»). Не число — NaN. */
export function parseMm(v: unknown): number { return parseFloat(String(v).replace(',', '.')); }

export function insetRect(r: Rect, d: number): Rect { return { x:r.x+d, y:r.y+d, w:r.w-2*d, h:r.h-2*d }; }

// ── Геометрия деления: 4-угольник [лево-верх, право-верх, право-низ, лево-низ] ──
export function quadFromRect(r: Rect): Quad {
  return [{x:r.x, y:r.y}, {x:r.x + r.w, y:r.y}, {x:r.x + r.w, y:r.y + r.h}, {x:r.x, y:r.y + r.h}];
}
function quadBounds(q: Quad): Rect {
  const xs = q.map(p => p.x), ys = q.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w:Math.max(...xs) - x, h:Math.max(...ys) - y };
}
// отсечение полуплоскостью: horiz → линия x = at, иначе y = at; keepLow — оставить x ≤ at (y ≤ at)
function clipQuad(q: Quad, horiz: boolean, at: number, keepLow: boolean): Quad {
  const c = (p: { x: number; y: number }) => horiz ? p.x : p.y;
  const inside = (p: { x: number; y: number }) => keepLow ? c(p) <= at : c(p) >= at;
  const res: Quad = [];
  for(let i = 0; i < q.length; i++){
    const a = q[i], b = q[(i + 1) % q.length], ia = inside(a), ib = inside(b);
    if(ia) res.push(a);
    if(ia !== ib){
      const t = (at - c(a)) / (c(b) - c(a));
      res.push(horiz ? { x:at, y:a.y + t * (b.y - a.y) } : { x:a.x + t * (b.x - a.x), y:at });
    }
  }
  return res.filter((p, i) => { const s = res[(i + res.length - 1) % res.length]; return res.length < 2 || p.x !== s.x || p.y !== s.y; });
}
// корректный 4-угольник: конечные координаты, выпуклый, обход в одну сторону, площадь > 0
export function quadOk(q: Quad | null | undefined): boolean {
  if(!q || q.length < 3 || !q.every(p => isFinite(p.x) && isFinite(p.y))) return false;
  let area = 0;
  for(let i = 0; i < q.length; i++){
    const a = q[i], b = q[(i + 1) % q.length], c = q[(i + 2) % q.length];
    area += a.x * b.y - b.x * a.y;
    if((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < -1e-9) return false;
  }
  return area > 1e-9;
}

// Деление узла. r — ограничивающий прямоугольник, quad — точная фигура.
//   Раздвижная ветка: оси от наружного края элемента, квоты = расстояния между осями (сумма = W).
//   Створная: квоты sizes от края (или оси предыдущего импоста) до оси следующего; равное деление — целыми мм.
//   ext — на сколько область узла (по осям импостов и краю рамы) шире r с каждой стороны.
export function layoutNode(node: TreeNode, r: Rect, out: SubLayout, profile: Profile, ext?: Ext, quad?: Quad): void {
  quad = quad || quadFromRect(r);
  if(node.kind === 'leaf'){ out.leaves.push({ node, rect:r, quad }); return; }
  const children = node.children!;
  const n = children.length;
  const horiz = node.dir === 'v';
  const sliding = !!(horiz && node.dividers && node.dividers.length === n - 1);
  const gaps = (node.dividers && node.dividers.length === n - 1)
    ? node.dividers.map(d => SLIDING_GAP[d] || 0)
    : new Array<number>(Math.max(0, n - 1)).fill(profile.mullion);
  const e0: Ext = sliding ? { l:0, t:0, r:0, b:0 } : (ext || { l:0, t:0, r:0, b:0 });
  const startExt = horiz ? e0.l : e0.t, endExt = horiz ? e0.r : e0.b;
  let origin: number, Lq: number;
  if(sliding){ const ft = out.frameT || 0; origin = r.x - ft; Lq = r.w + 2 * ft; }
  else{ origin = (horiz ? r.x : r.y) - startExt; Lq = (horiz ? r.w : r.h) + startExt + endExt; }
  let q = node.sizes;
  if(!q || q.length !== n){
    q = [];
    for(let i = 0; i < n; i++) q.push(sliding ? Lq / n : Math.round(Lq * (i + 1) / n) - Math.round(Lq * i / n));
  }else{
    const sum = q.reduce((a, b) => a + b, 0);
    if(sliding || Math.abs(sum - Lq) > 1e-6) q = q.map(x => x * Lq / sum);
  }
  node.sizes = q;                                     // запоминаем реальные мм (квоты)
  const quotas = q;
  let axis = origin, rest = quad, rr = r;
  const rect = (lo: number, hi: number): Rect => horiz ? { x:lo, y:rr.y, w:hi - lo, h:rr.h } : { x:rr.x, y:lo, w:rr.w, h:hi - lo };
  children.forEach((c, i) => {
    const cExt: Ext | undefined = sliding ? undefined : (horiz
      ? { l:(i === 0 ? e0.l : gaps[i-1] / 2), r:(i === n - 1 ? e0.r : gaps[i] / 2), t:e0.t, b:e0.b }
      : { t:(i === 0 ? e0.t : gaps[i-1] / 2), b:(i === n - 1 ? e0.b : gaps[i] / 2), l:e0.l, r:e0.r });
    if(i === n - 1){                                  // последняя ячейка — весь остаток
      const ok = rest.length >= 3;
      layoutNode(c, ok ? quadBounds(rest) : rr, out, profile, cExt, ok ? rest : quadFromRect(rr));
      return;
    }
    const next = axis + quotas[i], lo = next - gaps[i] / 2, hi = next + gaps[i] / 2;
    const cell = clipQuad(rest, horiz, lo, true);
    const cOk = cell.length >= 3;
    const cRect = cOk ? quadBounds(cell) : rect(horiz ? rr.x : rr.y, lo);
    layoutNode(c, cRect, out, profile, cExt, cOk ? cell : quadFromRect(cRect));
    const strip = clipQuad(clipQuad(rest, horiz, lo, false), horiz, hi, true);   // сам импост
    const mRect = strip.length >= 2 ? quadBounds(strip) : rect(lo, hi);
    const mr: MullionRect = Object.assign({}, mRect, { quad: strip.length >= 3 ? strip : quadFromRect(mRect) });
    if(node.dividers) mr.div = node.dividers[i];
    out.mullions.push(mr);
    rest = clipQuad(rest, horiz, hi, false);
    rr = horiz ? { x:hi, y:rr.y, w:rr.x + rr.w - hi, h:rr.h } : { x:rr.x, y:hi, w:rr.w, h:rr.y + rr.h - hi };
    axis = next;
  });
}

// Створная створка: l.cell — ячейка листа, l.rect — наружная кромка створки (выходит за ячейку на sashOverhang)
function applySashOuter(out: SubLayout, profile: Profile): void {
  const g = sashOverhang(profile);
  out.leaves.forEach(l => {
    if(!l.node.opening) return;
    const c = l.rect;
    l.cell = c;
    l.rect = { x:c.x - g, y:c.y - g, w:c.w + 2*g, h:c.h + 2*g };
  });
}
// переплёт внутри створки: node.inner в области створки за её полосой. Вызывать ПОСЛЕ applySashOuter.
function layoutInner(out: SubLayout, profile: Profile): void {
  out.leaves.forEach(l => {
    const n = l.node;
    if(n.opening && n.inner){
      const io: SubLayout = { leaves:[], mullions:[] };
      layoutNode(n.inner, insetRect(l.rect, sashBand(profile, n.opening)), io, profile);
      l.inner = io;
    }
  });
}
// раздвижные: створка = ячейка + заход на соседа у Interlock + заход под раму у крайних
function applySlidingSashes(out: Layout, inner: Rect, profile: Profile): void {
  const sp0 = SLIDING_PROFILE[profile.mat] || SLIDING_PROFILE.pvc;
  const vk = profile.vis || 1;
  const sp = { overlap: sp0.overlap * vk, under: sp0.under * vk };
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.5;
  out.leaves.forEach(l => {
    const r = l.rect, L = r.x, R = r.x + r.w;
    if(!l.node.opening){ l.cell = r; return; }
    let extL = 0, extR = 0;
    if(eq(L, inner.x)) extL = sp.under;
    else if(out.mullions.some(m => m.div === 'cap' && eq(m.x + m.w, L))) extL = sp.overlap;
    if(eq(R, inner.x + inner.w)) extR = sp.under;
    else if(out.mullions.some(m => m.div === 'cap' && eq(m.x, R))) extR = sp.overlap;
    l.cell = r;
    l.rect = { x:L - extL, y:r.y, w:r.w + extL + extR, h:r.h };
  });
}

/** Единая раскладка для чертежа и сметы. */
export function computeLayout(e: WinElement, profile?: Profile): Layout {
  profile = profile || profileFor(null);
  const root = ensureRoot(e);
  const W = parseMm(e.width)  || DEFAULT_W;
  const H = parseMm(e.height) || DEFAULT_H;
  const frameT = (e.type === 'sliding') ? profile.slidFrame : profile.frame;
  const inner: Rect = { x:frameT, y:frameT, w:W - 2*frameT, h:H - 2*frameT };
  const out: Layout = { leaves:[], mullions:[], W, H, inner, bead:profile.bead, profile, frameT, hasSill: !!e.sill, allMullions:[] };
  const rootExt: Ext = { l:frameT, t:frameT, r:frameT, b:frameT };
  layoutNode(root, inner, out, profile, rootExt);
  if(flattenSameDir(root)){                          // были вложенные деления в ту же сторону — раскладываем заново
    out.leaves = []; out.mullions = [];
    layoutNode(root, inner, out, profile, rootExt);
  }
  out.allMullions = out.mullions.slice();
  if(e.type === 'sliding'){
    out.slidingMat = profile.mat;
    applySlidingSashes(out, inner, profile);
  }else{
    applySashOuter(out, profile);
    layoutInner(out, profile);
  }
  return out;
}

// раскладка для рисования: профиль утолщается на больших окнах (одинаково для карточки, экрана и PDF)
export function layoutForDrawing(e: WinElement, project: Project | null | undefined): Layout {
  const W = parseMm(e.width)  || DEFAULT_W;
  const H = parseMm(e.height) || DEFAULT_H;
  return computeLayout(e, visualProfile(profileFor(project), W, H));
}
