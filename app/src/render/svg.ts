// Отрисовка схемы элемента в SVG (перенос DrawingView старого проекта).
// Одна и та же функция рисует экран элемента, миниатюры карточек и PDF.
import type { Edge, Layout, LayoutLeaf, Opening, Rect } from '../types.ts';
import { glassDefsSvg } from '../data/glass.ts';
import { sashBand, sashProfile } from '../data/profiles.ts';
import { insetRect } from '../model/layout.ts';
import {
  DOOR_HANDLE_L, DOOR_HANDLE_R, DOOR_HINGE, HINGE_H, HINGE_V, WIN_HANDLE_H, WIN_HANDLE_V, type VectorIcon
} from './icons.ts';

// значения из старого проекта: линии открывания чисто синие, контур профиля чёрный,
// точки петель на 0.2/0.8 кромки створки, ручка на 0.5 противоположной кромки
const OPEN_LINE = '#0000ff';
export const PROFILE_STROKE = '#1d1d1d';
// контуры — тонкая светлая линия в ~1 физический пиксель при любом размере схемы (non-scaling-stroke)
export const CONTOUR_COLOR = '#8c8c8c';
export function contourStyle(): string {
  const px = 1 / (globalThis.devicePixelRatio || 1);   // globalThis: в Node (сервер API) window нет
  return `<style>[stroke="${PROFILE_STROKE}"]{stroke:${CONTOUR_COLOR};stroke-width:${px}px;vector-effect:non-scaling-stroke}</style>`;
}
export const HINGE_T = [0.2, 0.8];
const HANDLE_T = 0.5;
export const OPPOSITE_EDGE: Record<Edge, Edge> = { left:'right', right:'left', top:'bottom', bottom:'top' };

type Pt = [number, number];

export function svgRect(r: Rect, attrs: string): string {
  return `<rect x="${r.x}" y="${r.y}" width="${Math.max(0,r.w)}" height="${Math.max(0,r.h)}" ${attrs}/>`;
}
// рама/створка с митрованными углами; цвет заливает ТОЛЬКО кольцо профиля (evenodd), чтобы стекло не лежало на цвете рамы
function miteredBand(outer: Rect, thickness: number, sw: number, stroke?: string | null, fill?: string): string {
  stroke = stroke || PROFILE_STROKE; fill = fill || '#ffffff';
  const inner = insetRect(outer, thickness);
  const s0 = `M${outer.x} ${outer.y}h${outer.w}v${outer.h}h${-outer.w}z M${inner.x} ${inner.y}h${Math.max(0, inner.w)}v${Math.max(0, inner.h)}h${-Math.max(0, inner.w)}z`;
  let s = `<path d="${s0}" fill="${fill}" fill-rule="evenodd" stroke="none"/>`;
  s += svgRect(outer, `fill="none" stroke="${stroke}" stroke-width="${sw}"`);
  s += svgRect(inner, `fill="none" stroke="${stroke}" stroke-width="${sw}"`);
  s += `<path d="M${outer.x} ${outer.y} L${inner.x} ${inner.y}
                 M${outer.x+outer.w} ${outer.y} L${inner.x+inner.w} ${inner.y}
                 M${outer.x} ${outer.y+outer.h} L${inner.x} ${inner.y+inner.h}
                 M${outer.x+outer.w} ${outer.y+outer.h} L${inner.x+inner.w} ${inner.y+inner.h}"
             stroke="${stroke}" stroke-width="${sw}" fill="none"/>`;
  return s;
}

export function edgePoint(r: Rect, edge: Edge, t: number): Pt {
  switch(edge){
    case 'left':   return [r.x, r.y + t*r.h];
    case 'right':  return [r.x+r.w, r.y + t*r.h];
    case 'top':    return [r.x + t*r.w, r.y];
    default:       return [r.x + t*r.w, r.y+r.h]; // bottom
  }
}
// точка ручки — на кромке напротив петель, сдвинута внутрь на inset (для ручки и линий — середина полосы створки)
export function handleAnchor(r: Rect, hingeEdge: Edge, inset?: number): Pt {
  const opp = OPPOSITE_EDGE[hingeEdge];
  let [x, y] = edgePoint(r, opp, HANDLE_T);
  const d = inset || 0;
  if(opp === 'left') x += d;
  else if(opp === 'right') x -= d;
  else if(opp === 'top') y += d;
  else y -= d;
  return [x, y];
}
function lineTarget(r: Rect, hingeEdge: Edge, band?: number): Pt {
  return handleAnchor(r, hingeEdge, (band || 60) / 2);
}

// цвет фурнитуры = цвет рамы: заливка умножается на цвет рамы (ColorFilter.tint(..., Multiply) в приложении)
let hwTint = '#ffffff';
export function tintHex(hex: string, tint: string): string {
  const p = (h: string): number[] => {
    h = String(h || '#ffffff').replace('#', '');
    if(h.length === 3) h = h.replace(/./g, c => c + c);
    const n = parseInt(h.slice(0, 6), 16);
    return isNaN(n) ? [255, 255, 255] : [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const a = p(hex), b = p(tint);
  return '#' + a.map((v, i) => Math.round(v * b[i] / 255).toString(16).padStart(2, '0')).join('');
}
// вписывает вектор (icon.w × icon.h) в прямоугольник x,y,W,H; контур — как у рамы (PROFILE_STROKE)
function vectorIconSvg(icon: VectorIcon, x: number, y: number, W: number, H: number, wrap?: string): string {
  const body = icon.paths.map(([d, fill, sw]) => `<path d="${d}" fill="${tintHex(fill, hwTint)}" stroke="${PROFILE_STROKE}" stroke-width="${sw}"/>`).join('');
  const g = `<g transform="translate(${x} ${y}) scale(${W / icon.w} ${H / icon.h})">${body}</g>`;
  return wrap ? `<g transform="${wrap}">${g}</g>` : g;
}
// петли: окно — 2 шт., дверь — 3 шт.; размер 16×128 (на горизонтальной кромке 128×16), k — визуальный масштаб
function hingeMarksSvg(r: Rect, edge: Edge, count: number, k?: number): string {
  k = k || 1;
  const vertical = (edge === 'left' || edge === 'right');
  const ts = (count === 3) ? [HINGE_T[0], 0.5, HINGE_T[1]] : HINGE_T.slice();
  const T = 16 * k, L = 128 * k;
  return ts.map(t => {
    const [x, y] = edgePoint(r, edge, t);
    if(count === 3){
      const wrap = vertical ? '' : `rotate(90 ${x} ${y})`;
      return vectorIconSvg(DOOR_HINGE, x - T/2, y - L/2, T, L, wrap);
    }
    return vertical
      ? vectorIconSvg(HINGE_V, x - T/2, y - L/2, T, L)
      : vectorIconSvg(HINGE_H, x - L/2, y - T/2, L, T);
  }).join('');
}
// оконная ручка 40×170: по ширине — середина полосы створки, по длине сдвиг на 1/4
function handleSvg(r: Rect, hingeEdge: Edge, band: number, k?: number): string {
  k = k || 1;
  const vertical = (OPPOSITE_EDGE[hingeEdge] === 'left' || OPPOSITE_EDGE[hingeEdge] === 'right');
  const W = (vertical ? 40 : 170) * k, H = (vertical ? 170 : 40) * k;
  const [cx, cy] = handleAnchor(r, hingeEdge, band ? band / 2 : (vertical ? W : H) / 2);
  return vertical
    ? vectorIconSvg(WIN_HANDLE_V, cx - W / 2, cy - H / 4, W, H)
    : vectorIconSvg(WIN_HANDLE_H, cx - W / 4, cy - H / 2, W, H);
}
// дверная ручка 140×200: накладка на середине полосы створки, рычаг смотрит внутрь стекла
function doorHandleSvg(r: Rect, hingeEdge: Edge, band: number, k?: number): string {
  k = k || 1;
  const opp = OPPOSITE_EDGE[hingeEdge];
  const W = 140 * k, H = 200 * k;
  const [cx, cy] = handleAnchor(r, hingeEdge, band ? band / 2 : 31 * k);
  const icon = (opp === 'left') ? DOOR_HANDLE_R : DOOR_HANDLE_L;
  const x = cx - (icon.plateX! / icon.w) * W, y = cy - H / 3;
  const wrap = (opp === 'top') ? `rotate(-90 ${cx} ${cy})` : (opp === 'bottom') ? `rotate(90 ${cx} ${cy})` : '';
  return vectorIconSvg(wrap ? DOOR_HANDLE_L : icon, x, y, W, H, wrap);
}
function openLinesSvg(r: Rect, hingeEdge: Edge, sw: number, band: number): string {
  const [hx, hy] = lineTarget(r, hingeEdge, band);
  const [x1, y1] = edgePoint(r, hingeEdge, HINGE_T[0]);
  const [x2, y2] = edgePoint(r, hingeEdge, HINGE_T[1]);
  return `<path d="M${x1} ${y1} L${hx} ${hy} M${x2} ${y2} L${hx} ${hy}" fill="none" stroke="${OPEN_LINE}" stroke-width="${sw*0.9}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// у двери линия идёт к отрезку на стороне ручки от 0,35 до 0,65 длины (по середине полосы створки)
function doorLinesSvg(r: Rect, hingeEdge: Edge, sw: number, band: number): string {
  const opp = OPPOSITE_EDGE[hingeEdge];
  const [x1, y1] = edgePoint(r, hingeEdge, HINGE_T[0]);
  const [x2, y2] = edgePoint(r, hingeEdge, HINGE_T[1]);
  const d = (band || 0) / 2;
  const shift = ([x, y]: Pt): Pt => (opp === 'left') ? [x + d, y] : (opp === 'right') ? [x - d, y] : (opp === 'top') ? [x, y + d] : [x, y - d];
  const a = shift(edgePoint(r, opp, 0.35)), b = shift(edgePoint(r, opp, 0.65));
  return `<path d="M${x1} ${y1} L${a[0]} ${a[1]} L${b[0]} ${b[1]} L${x2} ${y2}" fill="none" stroke="${OPEN_LINE}" stroke-width="${sw*0.9}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function openingSvg(r: Rect, op: Opening, sw: number, band: number, k?: number): string {
  let out = '';
  const edge = op.hinge as Edge;
  if(op.type === 'Turn' || op.type === 'Door'){
    out += (op.type === 'Door') ? doorLinesSvg(r, edge, sw, band) : openLinesSvg(r, edge, sw, band);
    out += hingeMarksSvg(r, edge, op.type === 'Door' ? 3 : 2, k);
    out += (op.type === 'Door') ? doorHandleSvg(r, edge, band, k) : handleSvg(r, edge, band, k);
  }else if(op.type === 'Tilt'){
    out += openLinesSvg(r, 'bottom', sw, band);
    out += hingeMarksSvg(r, 'bottom', 2, k);
    out += handleSvg(r, 'bottom', band, k);
  }else if(op.type === 'TiltTurn'){
    out += openLinesSvg(r, edge, sw, band);
    out += hingeMarksSvg(r, edge, 2, k);
    out += openLinesSvg(r, 'bottom', sw, band);
    out += handleSvg(r, edge, band, k);
  }
  return out;
}
// панель из планок шириной slat; последняя — остаток
function panelSvg(r: Rect, kind: string, sw: number, slat: number, color?: string): string {
  const step = Math.max(1, slat);
  const attrs = `fill="${color || '#ffffff'}" stroke="${PROFILE_STROKE}" stroke-width="${sw*0.6}"`;
  let out = '';
  if(kind === 'panelV'){
    for(let x = r.x; x < r.x + r.w - 0.5; x += step)
      out += svgRect({ x, y:r.y, w:Math.min(step, r.x + r.w - x), h:r.h }, attrs);
  }else{
    for(let y = r.y; y < r.y + r.h - 0.5; y += step)
      out += svgRect({ x:r.x, y, w:r.w, h:Math.min(step, r.y + r.h - y) }, attrs);
  }
  return out;
}
// стрелка движения раздвижной створки: треугольник 150×290 мм внутри видимого стекла ячейки, ≈78 % высоты
function slidingArrowSvg(cell: Rect, hinge: Edge | undefined, sw: number, k?: number, m?: number): string {
  k = k || 1; m = m || 0;
  const B = { x:cell.x + m, y:cell.y + m, w:Math.max(1, cell.w - 2*m), h:Math.max(1, cell.h - 2*m) };
  const dir = (hinge === 'left') ? 1 : -1;
  const x0 = (hinge === 'left') ? B.x : B.x + B.w;
  const triLen = Math.min(150 * k, B.w * 0.5), triH = Math.min(290 * k, B.h * 0.3);
  const y = Math.min(cell.y + cell.h * 0.78, B.y + B.h - triH / 2);
  const xTip  = x0 + dir * B.w * 0.85;
  const xBase = xTip - dir * triLen;
  const st = `fill="none" stroke="${OPEN_LINE}" stroke-width="${sw*0.9}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<path d="M${x0} ${y} L${xTip} ${y}" ${st}/>`
       + `<path d="M${xBase} ${y - triH/2} L${xTip} ${y} L${xBase} ${y + triH/2} Z" ${st}/>`;
}
// рама поверх створок: заход створок «под раму» скрывается ею
function frameRingSvg(outer: Rect, thickness: number, sw: number, color?: string): string {
  color = color || '#ffffff';
  const inner = insetRect(outer, thickness);
  const box = (r: Rect) => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}z`;
  return `<path d="${box(outer)}${box(inner)}" fill="${color}" fill-rule="evenodd" stroke="${PROFILE_STROKE}" stroke-width="${sw}"/>`
       + `<path d="M${outer.x} ${outer.y} L${inner.x} ${inner.y}
                 M${outer.x+outer.w} ${outer.y} L${inner.x+inner.w} ${inner.y}
                 M${outer.x} ${outer.y+outer.h} L${inner.x} ${inner.y+inner.h}
                 M${outer.x+outer.w} ${outer.y+outer.h} L${inner.x+inner.w} ${inner.y+inner.h}"
             stroke="${PROFILE_STROKE}" stroke-width="${sw}" fill="none"/>`;
}
const overlaySvg = (nid: number, rect: Rect): string =>
  svgRect(rect, `fill="transparent" data-nid="${nid}" style="cursor:pointer" onclick="selectNode(${nid})"`);

function buildSlidingSvg(W: number, H: number, out: Layout): string {
  const prof = out.profile;
  const color = out.color || '#ffffff';
  const sw = Math.max(W, H) / 330;
  const S: string[] = [];
  S.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">`);
  S.push(contourStyle());
  S.push(`<defs>
      ${glassDefsSvg(out.glass, W, H)}
    </defs>`);
  // Front Locking (6 мм) рисуем, Interlock (0 мм) — нет
  out.mullions.forEach(m => {
    if(m.w > 0.5 && m.h > 0.5) S.push(svgRect(m, `fill="${color}" stroke="${PROFILE_STROKE}" stroke-width="${sw}"`));
  });
  const isMoving = (l: LayoutLeaf) => (l.node.opening && l.node.opening.type === 'Sliding') ? 1 : 0;
  // штапик — рамка с митрой вокруг стекла, как в створном
  const drawGlass = (cell: Rect) => {
    S.push(miteredBand(cell, prof.bead, sw, null, color));
    S.push(svgRect(insetRect(cell, prof.bead), `fill="#ffffff" stroke="none"`));
    S.push(svgRect(insetRect(cell, prof.bead), `fill="url(#glassGrad)" stroke="${PROFILE_STROKE}" stroke-width="${sw*0.7}"`));
  };
  // слои: глухие внизу, подвижные сверху; среди подвижных — чем дальше от центра, тем выше
  const centerDist = (l: LayoutLeaf) => Math.abs(((l.cell || l.rect).x + (l.cell || l.rect).w / 2) - W / 2);
  out.leaves.slice().sort((a, b) => {
    const d = isMoving(a) - isMoving(b);
    if(d || !isMoving(a)) return d;
    const dd = centerDist(a) - centerDist(b);
    return Math.abs(dd) < 1 ? 0 : dd;
  }).forEach(l => {
    const n = l.node, r = l.rect;
    if(!n.opening){
      drawGlass(r);
      S.push(overlaySvg(n.nid, r));
      return;
    }
    const sashT = sashProfile(prof, n.opening);
    S.push(miteredBand(r, sashT, sw, null, color));
    drawGlass(insetRect(r, sashT));
    if(isMoving(l)) S.push(slidingArrowSvg(l.cell || r, n.opening.hinge, sw, prof.vis, sashT + prof.bead));
    S.push(overlaySvg(n.nid, r));
  });
  S.push(frameRingSvg({ x:0, y:0, w:W, h:H }, out.frameT, sw, color));
  if(out.hasSill) S.push(sillLedgeSvg(W, H, out.frameT, sw, color));
  S.push('</svg>');
  return S.join('');
}
// Подоконник под рамой — только рисунок (на смету не влияет)
function sillLedgeSvg(W: number, H: number, frameT: number, sw: number, color: string): string {
  const overhang = frameT * 0.8;
  const depth    = frameT * 0.9;
  const y0       = H - sw * 0.5;
  return `<rect x="${-overhang}" y="${y0}" width="${W + overhang * 2}" height="${depth}" `
       + `fill="${color}" stroke="${PROFILE_STROKE}" stroke-width="${sw}"/>`
       + `<line x1="${-overhang}" y1="${y0 + depth}" x2="${W + overhang}" y2="${y0 + depth}" `
       + `stroke="${PROFILE_STROKE}" stroke-width="${sw * 2.2}" stroke-linecap="round"/>`;
}
// отдельный элемент «Подоконник»: плита W×H, вид сверху; утолщённая линия — передний край
export function buildSillSvg(W: number, H: number, color?: string): string {
  color = color || '#ffffff';
  const sw = Math.max(W, H) / 330;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">`
    + contourStyle()
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="${color}" stroke="${PROFILE_STROKE}" stroke-width="${sw}"/>`
    + `<line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="${PROFILE_STROKE}" stroke-width="${sw * 2.5}"/>`
    + `</svg>`;
}
export function buildSvg(W: number, H: number, out: Layout): string {
  if(out.slidingMat) return buildSlidingSvg(W, H, out);
  const color = out.color || '#ffffff';
  const sw = Math.max(W, H) / 330;
  const S: string[] = [];
  S.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">`);
  S.push(contourStyle());
  S.push(`<defs>
      ${glassDefsSvg(out.glass, W, H)}
    </defs>`);
  const prof = out.profile;
  S.push(miteredBand({ x:0, y:0, w:W, h:H }, out.frameT, sw, null, color));   // рама
  out.mullions.forEach(m => S.push(svgRect(m, `fill="${color}" stroke="${PROFILE_STROKE}" stroke-width="${sw}"`)));
  out.leaves.forEach(l => {
    const n = l.node, r = l.rect;
    const sashT = sashBand(prof, n.opening);
    const bead = prof.bead;
    // штапик — рамка с митрой вокруг стекла; стекло лежит внутри штапика
    const drawCell = (node: typeof n, cell: Rect) => {
      S.push(miteredBand(cell, bead, sw, null, color));
      const glass = insetRect(cell, bead);
      S.push(svgRect(glass, `fill="#ffffff" stroke="none"`));
      S.push(svgRect(glass, `fill="url(#glassGrad)" stroke="${PROFILE_STROKE}" stroke-width="${sw*0.7}"`));
      if(node.fill === 'panelV' || node.fill === 'panelH') S.push(panelSvg(glass, node.fill, sw, prof.panelSlat, color));
    };
    if(n.opening) S.push(miteredBand(r, sashT, sw, null, color));
    if(n.opening && l.inner){
      // створка с переплётом: одна створка, несколько стёкол, между ними импост
      l.inner.mullions.forEach(m => S.push(svgRect(m, `fill="${color}" stroke="${PROFILE_STROKE}" stroke-width="${sw}"`)));
      l.inner.leaves.forEach(il => drawCell(il.node, il.rect));
    }else{
      drawCell(n, n.opening ? insetRect(r, sashT) : r);
    }
    hwTint = color;   // ручки и петли — в цвет рамы
    if(n.opening) S.push(openingSvg(r, n.opening, sw, sashT, prof.vis));
    S.push(overlaySvg(n.nid, r));
    if(n.opening && l.inner) l.inner.leaves.forEach(il => S.push(overlaySvg(il.node.nid, il.rect)));
  });
  if(out.hasSill) S.push(sillLedgeSvg(W, H, out.frameT, sw, color));
  S.push('</svg>');
  return S.join('');
}
