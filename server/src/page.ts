// Страница A4 элемента — SVG 1240×1754 (150 dpi), повторяет страницу элемента из PDF приложения
// (features/pdf.ts → pdfDrawElement): шапка, крупный чертёж с размерными цепочками, таблица и створки.
// В приложении то же рисуется на canvas; здесь — SVG, который pdf.ts растеризует через resvg.
import type { Layout, Project, WinElement } from '../../app/src/types.ts';
import { elementColorHex } from '../../app/src/data/colors.ts';
import { elementGlassName } from '../../app/src/data/glass.ts';
import { profileFor } from '../../app/src/data/profiles.ts';
import { computeLayout } from '../../app/src/model/layout.ts';
import { globalChain, type DimSeg } from '../../app/src/model/dims.ts';
import { elementGeometry, fmtNum } from '../../app/src/model/pricing.ts';
import { drawingSvg, leafDesc } from '../../app/src/render/drawingSvg.ts';
import { pdfT } from '../../app/src/features/pdfI18n.ts';

export const PAGE_W = 1240, PAGE_H = 1754;
const M = 90;
const INK = '#1d1d1d', GREY = '#6b7280', LINE = '#d9dde3', DIM = '#333333', EXT = '#b8bec8';
export const PAGE_FONT = 'DejaVu Sans';

export function escapeXml(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
interface TextOpts { bold?: boolean; color?: string; anchor?: 'start' | 'middle' | 'end'; maxW?: number; rotate?: boolean; }
// ширина текста DejaVu Sans на глаз (canvas measureText тут нет): ~0.6 em на знак.
// Длиннее maxW — сначала уменьшаем шрифт до 0.75, потом сжимаем textLength до 0.8, дальше обрезаем с «…».
const EM = 0.6, MIN_FONT = 0.75, MIN_SQUEEZE = 0.8;
function text(s: unknown, x: number, y: number, size: number, o: TextOpts = {}): string {
  let t = String(s), fit = '';
  if(o.maxW){
    if(t.length * size * EM > o.maxW) size = Math.max(Math.round(size * MIN_FONT), Math.floor(o.maxW / (t.length * EM)));
    const maxChars = Math.floor(o.maxW / (size * EM * MIN_SQUEEZE));
    if(t.length > maxChars) t = t.slice(0, maxChars - 1) + '…';
    if(t.length * size * EM > o.maxW) fit = ` textLength="${o.maxW}" lengthAdjust="spacingAndGlyphs"`;
  }
  const rot = o.rotate ? ` transform="rotate(-90 ${x} ${y})"` : '';
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${o.bold ? 600 : 400}" fill="${o.color || INK}" text-anchor="${o.anchor || 'start'}"${fit}${rot}>${escapeXml(t)}</text>`;
}
const line = (x0: number, y0: number, x1: number, y1: number, color: string, w: number) =>
  `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" stroke-width="${w}"/>`;
const bar = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${LINE}"/>`;

// --- размерные линии (как pdfDimH / pdfDimV / pdfDimsX / pdfDimsY в приложении) ---
const tick = (x: number, y: number) => line(x - 8, y + 8, x + 8, y - 8, DIM, 2);
function bounds(segs: DimSeg[], len: number): number[] {
  const sum = segs.reduce((a, s) => a + s.size, 0) || 1;
  let c = 0; const b = [0];
  segs.forEach(s => { c += s.size; b.push(c / sum * len); });
  return b;
}
function dimH(x0: number, x1: number, y: number, label: string, bold: boolean): string {
  const size = bold ? 34 : ((x1 - x0) < 90 ? 24 : 30);
  return line(x0, y, x1, y, DIM, 2) + tick(x0, y) + tick(x1, y) + text(label, (x0 + x1) / 2, y - 12, size, { bold, anchor: 'middle' });
}
function dimV(x: number, y0: number, y1: number, label: string, bold: boolean): string {
  const size = bold ? 34 : ((y1 - y0) < 90 ? 24 : 30);
  return line(x, y0, x, y1, DIM, 2) + tick(x, y0) + tick(x, y1) + text(label, x - 12, (y0 + y1) / 2, size, { bold, anchor: 'middle', rotate: true });
}
function dimsX(x: number, bottom: number, len: number, segs: DimSeg[], total: number): string {
  const rowS = bottom + 58, rowT = segs.length ? bottom + 128 : bottom + 58;
  const b = bounds(segs, len);
  let s = '';
  if(segs.length){
    b.forEach(bx => { s += line(x + bx, bottom + 8, x + bx, rowS + 12, EXT, 1.5); });
    s += line(x, rowS + 12, x, rowT + 12, EXT, 1.5) + line(x + len, rowS + 12, x + len, rowT + 12, EXT, 1.5);
    segs.forEach((g, k) => { s += dimH(x + b[k], x + b[k + 1], rowS, String(Math.round(g.size)), false); });
  }else{
    s += line(x, bottom + 8, x, rowT + 12, EXT, 1.5) + line(x + len, bottom + 8, x + len, rowT + 12, EXT, 1.5);
  }
  return s + dimH(x, x + len, rowT, String(Math.round(total)), true);
}
function dimsY(x: number, top: number, len: number, segs: DimSeg[], total: number): string {
  const colS = x - 58, colT = segs.length ? x - 128 : x - 58;
  const b = bounds(segs, len);
  let s = '';
  if(segs.length){
    b.forEach(by => { s += line(x - 8, top + by, colS - 12, top + by, EXT, 1.5); });
    s += line(colS - 12, top, colT - 12, top, EXT, 1.5) + line(colS - 12, top + len, colT - 12, top + len, EXT, 1.5);
    segs.forEach((g, k) => { s += dimV(colS, top + b[k], top + b[k + 1], String(Math.round(g.size)), false); });
  }else{
    s += line(x - 8, top, colT - 12, top, EXT, 1.5) + line(x - 8, top + len, colT - 12, top + len, EXT, 1.5);
  }
  return s + dimV(colT, top, top + len, String(Math.round(total)), true);
}

/** Раскладка для чертежа — как drawLayout в features/pdf.ts. */
export function drawLayout(e: WinElement, project: Project): Layout {
  const out = computeLayout(e, profileFor(project));
  out.color = elementColorHex(e, project); out.glass = e.glass; out.elType = e.type;
  return out;
}

/** Страница элемента idx (с 0) в виде SVG A4. */
export function elementPageSvg(project: Project, idx: number): string {
  const e = project.elements[idx], total = project.elements.length;
  const out = drawLayout(e, project);
  const W = out.W, H = out.H, qty = Number(e.qty) || 1;
  const p: string[] = [];
  // шапка
  p.push(text(project.name, M, 78, 26, { color: GREY, maxW: 800 }));
  p.push(text((idx + 1) + ' / ' + total, PAGE_W - M, 78, 26, { color: GREY, anchor: 'end' }));
  p.push(bar(M, 96, PAGE_W - 2 * M, 2));
  p.push(text(pdfT('element') + ' ' + (idx + 1), M, 178, 54, { bold: true }));
  p.push(text(Math.round(W) + ' × ' + Math.round(H) + ' ' + pdfT('mm'), PAGE_W - M, 178, 40, { color: GREY, anchor: 'end' }));

  // чертёж в области AX0..AX1 × AY0..AY0+AH
  const AX0 = M + 170, AX1 = PAGE_W - M, AY0 = 250, AW = AX1 - AX0, AH = 830;
  const sc = Math.min(AW / W, AH / H);
  const dw = Math.round(W * sc), dh = Math.round(H * sc);
  const dx = Math.round(AX0 + (AW - dw) / 2), dy = Math.round(AY0 + (AH - dh) / 2);
  const sv = drawingSvg(out, dw, dh, 2.2);
  p.push(sv.svg.replace('<svg ', `<svg x="${dx - sv.padX}" y="${dy}" `));
  p.push(dimsX(dx, dy + dh, dw, globalChain(e.root, 'x', null, W), W));
  p.push(dimsY(dx, dy, dh, globalChain(e.root, 'y', null, H), H));

  // таблица и створки
  p.push(bar(M, 1320, PAGE_W - 2 * M, 2));
  const rows: [string, string][] = [
    [pdfT('size'),         Math.round(W) + ' × ' + Math.round(H) + ' ' + pdfT('mm')],
    [pdfT('qty'),          fmtNum(qty, 0, 2) + ' ' + pdfT('pcs')],
    [pdfT('construction'), e.type === 'sill' ? pdfT('typeSill') : (e.type === 'sliding') ? pdfT('slidingShort') : pdfT('casementShort')]
  ];
  const isSill = e.type === 'sill';                    // у отдельного подоконника нет площади окна, стекла и створок
  if(!isSill) rows.push([pdfT('area'), fmtNum(W * H / 1e6 * qty, 2) + ' м²'], [pdfT('glassColor'), elementGlassName(e)]);
  if(e.type === 'sill' || e.sill){
    const g = elementGeometry(e, project.type === 'alu' ? 'alu' : 'pvc');   // как в смете: длина и ширина полки
    rows.push([pdfT('sill'), fmtNum(g.sillLen * qty, 2) + ' ' + pdfT('m') + ' × ' + g.sillWidth + ' ' + pdfT('cm')]);
  }
  if(e.net) rows.push([pdfT('net'), 'есть']);
  rows.forEach((r, i) => {
    const y = 1382 + i * 54;
    p.push(text(r[0], M, y, 30, { color: GREY }));
    p.push(text(r[1], 390, y, 30, { bold: true, maxW: 230 }));
  });
  if(!isSill) p.push(text(pdfT('sashes'), 640, 1382, 30, { color: GREY }));
  const leaves = isSill ? [] : out.leaves.map(l => leafDesc(l.node));
  const show = leaves.length > 5 ? 4 : leaves.length;
  for(let i = 0; i < show; i++) p.push(text((i + 1) + '. ' + leaves[i], 640, 1436 + i * 54, 28, { maxW: PAGE_W - M - 640 }));
  if(leaves.length > 5) p.push(text(pdfT('andMore') + ' ' + (leaves.length - 4), 640, 1436 + 4 * 54, 28, { color: GREY }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}" font-family="${PAGE_FONT}">`
    + `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>` + p.join('') + `</svg>`;
}
