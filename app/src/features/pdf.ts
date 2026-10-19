// PDF без библиотек: страницы A4 рисуются на canvas (150 dpi), чертёж — тот же buildSvg, страницы — JPEG в PDF.
// Здесь общий движок (используют PDF проекта, каталога и раскроя) и PDF проекта (кнопка «Поделиться»).
import type { Layout, Project, WinElement } from '../types.ts';
import { showToast } from '../ui/dom.ts';
import { elementColorHex } from '../data/colors.ts';
import { elementGlassName } from '../data/glass.ts';
import { profileFor } from '../data/profiles.ts';
import { computeLayout } from '../model/layout.ts';
import { globalChain, type DimSeg } from '../model/dims.ts';
import { calcProject, fmtMoney, fmtNum, type ProjectCost } from '../model/pricing.ts';
import { S } from '../state.ts';
import { drawingSvg, leafDesc } from '../render/drawingSvg.ts';
import { deliverFile } from '../platform/share.ts';
import { getCurrentProject } from '../storage.ts';
import { openPdfOptions, pdfLineName, pdfOpts, pdfT } from './pdfI18n.ts';

export const PDF_PW = 1240, PDF_PH = 1754, PDF_M = 90;
export const PDF_FONT = '"Helvetica Neue", Arial, "Segoe UI", Roboto, sans-serif';
export const PDF_INK = '#1d1d1d', PDF_GREY = '#6b7280', PDF_LINE = '#d9dde3', PDF_DIM = '#333333';
const PDF_EXT = '#b8bec8';
const PDF_LIST_ROW = 120, PDF_LIST_CAP_FIRST = 9, PDF_LIST_CAP_NEXT = 12;

/** Флаг «PDF уже собирается» — общий для всех видов PDF. */
export const pdfState = { busy: false };

export interface JpegPage { data: Uint8Array; w: number; h: number; }
export interface PdfPage { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; }
interface TextOpts { bold?: boolean; color?: string; align?: CanvasTextAlign; maxW?: number; }

function pdfClean(s: unknown): string { return String(s).replace(/[  ]/g, ' '); }
export function pdfText(ctx: CanvasRenderingContext2D, s: unknown, x: number, y: number, size: number, o?: TextOpts): void {
  o = o || {};
  ctx.font = (o.bold ? '600 ' : '400 ') + size + 'px ' + PDF_FONT;
  ctx.fillStyle = o.color || PDF_INK;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = 'alphabetic';
  let t = pdfClean(s);
  if(o.maxW && ctx.measureText(t).width > o.maxW){
    while(t.length > 1 && ctx.measureText(t + '…').width > o.maxW) t = t.slice(0, -1);
    t += '…';
  }
  ctx.fillText(t, x, y);
}
export function pdfLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}
export function pdfNewPage(): PdfPage {
  const c = document.createElement('canvas');
  c.width = PDF_PW; c.height = PDF_PH;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PDF_PW, PDF_PH);
  return { c, ctx };
}
function pdfHeader(ctx: CanvasRenderingContext2D, project: Project, no: number, total: number): void {
  pdfText(ctx, project.name, PDF_M, 78, 26, { color:PDF_GREY, maxW:800 });
  pdfText(ctx, no + ' / ' + total, PDF_PW - PDF_M, 78, 26, { color:PDF_GREY, align:'right' });
  ctx.fillStyle = PDF_LINE; ctx.fillRect(PDF_M, 96, PDF_PW - 2*PDF_M, 2);
}

export function pdfLoadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('svg'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

// --- размерные линии ---
function pdfTick(ctx: CanvasRenderingContext2D, x: number, y: number): void { pdfLine(ctx, x - 8, y + 8, x + 8, y - 8); }
function pdfBounds(segs: DimSeg[], len: number): number[] {
  const sum = segs.reduce((a, s) => a + s.size, 0) || 1;
  let c = 0; const b = [0];
  segs.forEach(s => { c += s.size; b.push(c / sum * len); });
  return b;
}
function pdfDimH(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, label: string, bold: boolean): void {
  ctx.strokeStyle = PDF_DIM; ctx.lineWidth = 2;
  pdfLine(ctx, x0, y, x1, y); pdfTick(ctx, x0, y); pdfTick(ctx, x1, y);
  const size = bold ? 34 : ((x1 - x0) < 90 ? 24 : 30);
  pdfText(ctx, label, (x0 + x1) / 2, y - 12, size, { bold, align:'center' });
}
function pdfDimV(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, label: string, bold: boolean): void {
  ctx.strokeStyle = PDF_DIM; ctx.lineWidth = 2;
  pdfLine(ctx, x, y0, x, y1); pdfTick(ctx, x, y0); pdfTick(ctx, x, y1);
  const size = bold ? 34 : ((y1 - y0) < 90 ? 24 : 30);
  ctx.save();
  ctx.translate(x - 12, (y0 + y1) / 2);
  ctx.rotate(-Math.PI / 2);
  pdfText(ctx, label, 0, 0, size, { bold, align:'center' });
  ctx.restore();
}
function pdfDimsX(ctx: CanvasRenderingContext2D, x: number, bottom: number, len: number, segs: DimSeg[], total: number): void {
  const rowS = bottom + 58, rowT = segs.length ? bottom + 128 : bottom + 58;
  const b = pdfBounds(segs, len);
  ctx.strokeStyle = PDF_EXT; ctx.lineWidth = 1.5;
  if(segs.length){
    b.forEach(bx => pdfLine(ctx, x + bx, bottom + 8, x + bx, rowS + 12));
    pdfLine(ctx, x, rowS + 12, x, rowT + 12); pdfLine(ctx, x + len, rowS + 12, x + len, rowT + 12);
    segs.forEach((s, k) => pdfDimH(ctx, x + b[k], x + b[k + 1], rowS, String(Math.round(s.size)), false));
  }else{
    pdfLine(ctx, x, bottom + 8, x, rowT + 12); pdfLine(ctx, x + len, bottom + 8, x + len, rowT + 12);
  }
  pdfDimH(ctx, x, x + len, rowT, String(Math.round(total)), true);
}
function pdfDimsY(ctx: CanvasRenderingContext2D, x: number, top: number, len: number, segs: DimSeg[], total: number): void {
  const colS = x - 58, colT = segs.length ? x - 128 : x - 58;
  const b = pdfBounds(segs, len);
  ctx.strokeStyle = PDF_EXT; ctx.lineWidth = 1.5;
  if(segs.length){
    b.forEach(by => pdfLine(ctx, x - 8, top + by, colS - 12, top + by));
    pdfLine(ctx, colS - 12, top, colT - 12, top); pdfLine(ctx, colS - 12, top + len, colT - 12, top + len);
    segs.forEach((s, k) => pdfDimV(ctx, colS, top + b[k], top + b[k + 1], String(Math.round(s.size)), false));
  }else{
    pdfLine(ctx, x - 8, top, colT - 12, top); pdfLine(ctx, x - 8, top + len, colT - 12, top + len);
  }
  pdfDimV(ctx, colT, top, top + len, String(Math.round(total)), true);
}

const pdfTypeName = (e: WinElement) => (e.type === 'sill') ? pdfT('typeSill') : (e.type === 'sliding') ? pdfT('typeSliding') : pdfT('typeCasement');

type PlanPage = { kind: 'list'; from: number; to: number; first: boolean } | { kind: 'elem'; idx: number } | { kind: 'estimate' };
// план страниц: сначала считаем их число (нужно для «стр. / всего»), потом рисуем
function pdfPlan(project: Project): PlanPage[] {
  const pages: PlanPage[] = [], n = project.elements.length;
  for(let i = 0, first = true; i < n; first = false){
    const cap = first ? PDF_LIST_CAP_FIRST : PDF_LIST_CAP_NEXT;
    pages.push({ kind:'list', from:i, to:Math.min(n, i + cap), first });
    i += cap;
  }
  for(let k = 0; k < n; k++) pages.push({ kind:'elem', idx:k });
  if(pdfOpts().prices) pages.push({ kind:'estimate' });
  return pages;
}
function drawLayout(e: WinElement, project: Project): Layout {
  const out = computeLayout(e, profileFor(project));
  out.color = elementColorHex(e, project); out.glass = e.glass; out.elType = e.type;
  return out;
}

// --- страница-список: заголовок, сводка, состав с эскизами ---
async function pdfDrawList(pg: PdfPage, project: Project, res: ProjectCost, plan: Extract<PlanPage, { kind: 'list' }>, no: number, total: number): Promise<void> {
  const ctx = pg.ctx;
  pdfHeader(ctx, project, no, total);
  let y0: number;
  if(plan.first){
    const mat = (project.type === 'alu') ? pdfT('alu') : pdfT('pvc');
    let ts = 64;   // длинное название уменьшаем, пока не влезет
    ctx.font = '600 ' + ts + 'px ' + PDF_FONT;
    while(ts > 40 && ctx.measureText(pdfClean(project.name)).width > PDF_PW - 2*PDF_M){ ts -= 4; ctx.font = '600 ' + ts + 'px ' + PDF_FONT; }
    pdfText(ctx, project.name, PDF_M, 230, ts, { bold:true, maxW:PDF_PW - 2*PDF_M });
    pdfText(ctx, project.date + '  ·  ' + mat, PDF_M, 285, 30, { color:PDF_GREY });
    const stats: [string, string][] = [
      [String(project.elements.length), pdfT('elements')],
      [fmtNum(res.totals.qty, 0), pdfT('pcsTotal')],
      [fmtNum(res.totals.area, 2) + ' м²', pdfT('totalArea')]
    ];
    stats.forEach((s, i) => {
      const x = PDF_M + i * 370;
      pdfText(ctx, s[0], x, 385, 50, { bold:true });
      pdfText(ctx, s[1], x, 425, 26, { color:PDF_GREY });
    });
    pdfText(ctx, pdfT('composition'), PDF_M, 505, 28, { color:PDF_GREY });
    ctx.fillStyle = PDF_LINE; ctx.fillRect(PDF_M, 525, PDF_PW - 2*PDF_M, 2);
    y0 = 527;
  }else{
    pdfText(ctx, pdfT('compositionCont'), PDF_M, 178, 28, { color:PDF_GREY });
    y0 = 200;
  }
  for(let i = plan.from; i < plan.to; i++){
    const e = project.elements[i], c = res.items[i];
    const y = y0 + (i - plan.from) * PDF_LIST_ROW;
    pdfText(ctx, String(i + 1), PDF_M, y + 74, 46, { color:PDF_GREY });
    const out = drawLayout(e, project);
    const k = 100 / Math.max(out.W, out.H);
    const tw = Math.max(1, Math.round(out.W * k)), th = Math.max(1, Math.round(out.H * k));
    const sv = drawingSvg(out, tw, th, 1.2);
    const img = await pdfLoadSvg(sv.svg);
    ctx.drawImage(img, 170 + Math.round((100 - tw) / 2) - sv.padX, y + 10 + Math.round((100 - th) / 2), sv.w, sv.h);
    if(pdfOpts().sizes){
      pdfText(ctx, Math.round(out.W) + ' × ' + Math.round(out.H) + ' ' + pdfT('mm'), 310, y + 55, 34, { bold:true });
      pdfText(ctx, pdfTypeName(e), 310, y + 96, 28, { color:PDF_GREY });
    }else{
      pdfText(ctx, pdfTypeName(e), 310, y + 70, 34, { bold:true });
    }
    pdfText(ctx, '× ' + fmtNum(c.qty, 0, 2), PDF_PW - PDF_M, y + 55, 40, { bold:true, align:'right' });
    const sub = e.type === 'sill' ? fmtNum(c.g.sillLen * c.qty, 2) + ' ' + pdfT('m') : fmtNum(c.g.area, 2) + ' м²';   // у подоконника — длина
    pdfText(ctx, pdfOpts().prices ? fmtMoney(c.roundedTotal || 0) : sub, PDF_PW - PDF_M, y + 96, 28, { color:PDF_GREY, align:'right' });
    ctx.fillStyle = PDF_LINE; ctx.fillRect(PDF_M, y + PDF_LIST_ROW - 1, PDF_PW - 2*PDF_M, 1.5);
  }
}

// --- страница элемента: крупный чертёж с размерами и подписи ---
async function pdfDrawElement(pg: PdfPage, project: Project, res: ProjectCost, idx: number, no: number, total: number): Promise<void> {
  const ctx = pg.ctx;
  const e = project.elements[idx], c = res.items[idx];
  pdfHeader(ctx, project, no, total);
  const out = drawLayout(e, project);
  const W = out.W, H = out.H;
  const sizes = pdfOpts().sizes;
  pdfText(ctx, pdfT('element') + ' ' + (idx + 1), PDF_M, 178, 54, { bold:true });
  if(sizes) pdfText(ctx, Math.round(W) + ' × ' + Math.round(H) + ' ' + pdfT('mm'), PDF_PW - PDF_M, 178, 40, { color:PDF_GREY, align:'right' });

  const AX0 = PDF_M + 170, AX1 = PDF_PW - PDF_M, AY0 = 250, AW = AX1 - AX0, AH = 830;
  const sc = Math.min(AW / W, AH / H);
  const dw = Math.round(W * sc), dh = Math.round(H * sc);
  const dx = Math.round(AX0 + (AW - dw) / 2), dy = Math.round(AY0 + (AH - dh) / 2);
  const sv = drawingSvg(out, dw, dh, 2.2);
  const img = await pdfLoadSvg(sv.svg);
  ctx.drawImage(img, dx - sv.padX, dy, sv.w, sv.h);
  // globalChain собирает ВСЕ разрезы по оси (не только в первой колонке)
  if(sizes){
    pdfDimsX(ctx, dx, dy + dh, dw, globalChain(e.root, 'x', null, W), W);
    pdfDimsY(ctx, dx, dy, dh, globalChain(e.root, 'y', null, H), H);
  }

  ctx.fillStyle = PDF_LINE; ctx.fillRect(PDF_M, 1320, PDF_PW - 2*PDF_M, 2);
  const rows: [string, string][] = [];
  if(sizes) rows.push([pdfT('size'), Math.round(W) + ' × ' + Math.round(H) + ' ' + pdfT('mm')]);
  rows.push(
    [pdfT('qty'),          fmtNum(c.qty, 0, 2) + ' ' + pdfT('pcs')],
    [pdfT('construction'), e.type === 'sill' ? pdfT('typeSill') : (e.type === 'sliding') ? pdfT('slidingShort') : pdfT('casementShort')]
  );
  const isSill = e.type === 'sill';                    // у отдельного подоконника нет площади окна, стекла и створок
  if(!isSill) rows.push([pdfT('area'), fmtNum(c.g.area, 2) + ' м²'], [pdfT('glassColor'), elementGlassName(e)]);
  if(e.type === 'sill' || e.sill) rows.push([pdfT('sill'), fmtNum((c.g.sillLen || 0) * c.qty, 2) + ' ' + pdfT('m') + ' × ' + (c.g.sillWidth || 20) + ' ' + pdfT('cm')]);
  if(c.g.nets.length) rows.push([pdfT('net'), c.g.nets.length + ' ' + pdfT('pcs')]);
  if(pdfOpts().prices) rows.push([pdfT('price'), fmtMoney(c.roundedTotal || 0)]);
  rows.forEach((r, i) => {
    const y = 1382 + i * 54;
    pdfText(ctx, r[0], PDF_M, y, 30, { color:PDF_GREY });
    pdfText(ctx, r[1], 390, y, 30, { bold:true, maxW:230 });
  });
  if(!isSill) pdfText(ctx, pdfT('sashes'), 640, 1382, 30, { color:PDF_GREY });
  const leaves = isSill ? [] : out.leaves.map(l => leafDesc(l.node));
  const show = leaves.length > 5 ? 4 : leaves.length;
  for(let i = 0; i < show; i++) pdfText(ctx, (i + 1) + '. ' + leaves[i], 640, 1436 + i * 54, 28, { maxW:PDF_PW - PDF_M - 640 });
  if(leaves.length > 5) pdfText(ctx, pdfT('andMore') + ' ' + (leaves.length - 4), 640, 1436 + 4 * 54, 28, { color:PDF_GREY });
}

// --- страница сметы (только при «Показывать цены») ---
function pdfDrawEstimate(pg: PdfPage, project: Project, res: ProjectCost, no: number, total: number): void {
  const ctx = pg.ctx;
  pdfHeader(ctx, project, no, total);
  const X0 = PDF_M, X1 = PDF_PW - PDF_M;
  pdfText(ctx, pdfT('estimate'), X0, 178, 54, { bold:true });
  const cQty = X0 + 700, cUnit = X0 + 730, cSum = X1;
  let y = 260;
  pdfText(ctx, pdfT('colName'), X0, y, 26, { color:PDF_GREY });
  pdfText(ctx, pdfT('colQty'), cQty, y, 26, { color:PDF_GREY, align:'right' });
  pdfText(ctx, pdfT('colUnit'), cUnit, y, 26, { color:PDF_GREY });
  pdfText(ctx, pdfT('colSum'), cSum, y, 26, { color:PDF_GREY, align:'right' });
  ctx.fillStyle = PDF_LINE; ctx.fillRect(X0, y + 16, X1 - X0, 2);
  y += 62;
  const dec = Math.max(0, S.prices.decimals | 0);
  res.lines.forEach((l, i) => {
    if(i % 2){ ctx.fillStyle = '#f5f6f8'; ctx.fillRect(X0, y - 34, X1 - X0, 48); }
    pdfText(ctx, pdfLineName(l.name), X0 + 8, y, 28, { maxW:600 });
    pdfText(ctx, fmtNum(l.qty, 0, 1), cQty, y, 28, { align:'right' });
    pdfText(ctx, l.unit === 'шт' ? pdfT('pcs') : l.unit === 'м' ? pdfT('m') : l.unit, cUnit, y, 28, { color:PDF_GREY });
    pdfText(ctx, fmtNum(l.sum, 0, dec), cSum - 8, y, 28, { align:'right' });
    y += 48;
  });
  ctx.fillStyle = PDF_LINE; ctx.fillRect(X0, y - 20, X1 - X0, 2);
  y += 40;
  const tot: [string, string, boolean][] = [[pdfT('subtotal'), fmtMoney(res.subtotal), false]];
  if(res.discount > 0) tot.push([pdfT('discount'), '− ' + fmtMoney(res.discount), false]);
  tot.push(
    [pdfT('tax') + ' (' + fmtNum(res.taxRate, 0) + ' %)', fmtMoney(res.tax), false],
    [pdfT('grand') + ' (' + S.prices.currency + ')', fmtMoney(res.grand), true]
  );
  if(res.advance > 0) tot.push([pdfT('advance'), fmtMoney(res.advance), false], [pdfT('due'), fmtMoney(res.due), true]);
  tot.forEach(([a, b, bold]) => {
    pdfText(ctx, a, X0 + 380, y, bold ? 36 : 30, { bold, color:bold ? PDF_INK : PDF_GREY });
    pdfText(ctx, b, X1, y, bold ? 36 : 30, { bold, align:'right' });
    y += bold ? 60 : 50;
  });
}

export function pdfCanvasJpeg(canvas: HTMLCanvasElement): Promise<JpegPage> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async b => {
      if(!b){ reject(new Error('jpeg')); return; }
      resolve({ data:new Uint8Array(await b.arrayBuffer()), w:canvas.width, h:canvas.height });
    }, 'image/jpeg', 0.92);
  });
}
async function buildProjectPdfPages(project: Project): Promise<JpegPage[]> {
  const res = calcProject(project);
  const plan = pdfPlan(project);
  const jpegs: JpegPage[] = [];
  for(let i = 0; i < plan.length; i++){
    const pg = pdfNewPage(), p = plan[i], no = i + 1;
    if(p.kind === 'list')      await pdfDrawList(pg, project, res, p, no, plan.length);
    else if(p.kind === 'elem') await pdfDrawElement(pg, project, res, p.idx, no, plan.length);
    else                       pdfDrawEstimate(pg, project, res, no, plan.length);
    jpegs.push(await pdfCanvasJpeg(pg.c));
    pg.c.width = pg.c.height = 0;   // освободить память страницы
  }
  return jpegs;
}

// --- минимальный писатель PDF: каждая страница — одна JPEG-картинка на весь лист A4 ---
export function pdfFromJpegs(jpegs: JpegPage[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], offs: number[] = [];
  let len = 0;
  const put = (x: string | Uint8Array) => { const b = (typeof x === 'string') ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const A4W = 595.28, A4H = 841.89, n = jpegs.length, total = 2 + 3 * n;
  put('%PDF-1.4\n');
  offs[1] = len; put('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const kids = jpegs.map((_, i) => (3 + 3 * i) + ' 0 R').join(' ');
  offs[2] = len; put('2 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + n + ' >>\nendobj\n');
  jpegs.forEach((j, i) => {
    const pg = 3 + 3 * i, ct = pg + 1, im = pg + 2;
    offs[pg] = len;
    put(pg + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4W + ' ' + A4H + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>\nendobj\n');
    const cs = 'q ' + A4W + ' 0 0 ' + A4H + ' 0 0 cm /Im0 Do Q';
    offs[ct] = len;
    put(ct + ' 0 obj\n<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream\nendobj\n');
    offs[im] = len;
    put(im + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + j.w + ' /Height ' + j.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + j.data.length + ' >>\nstream\n');
    put(j.data);
    put('\nendstream\nendobj\n');
  });
  const xref = len;
  let x = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
  for(let i = 1; i <= total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  put(x + 'trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  const all = new Uint8Array(len);
  let p = 0;
  parts.forEach(b => { all.set(b, p); p += b.length; });
  return all;
}
export const safeFileName = (s: string, def: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || def;

// кнопка «Поделиться»: сначала язык и состав PDF, потом сборка
export function shareProjectPdf(): void {
  const project = getCurrentProject();
  if(!project || project.elements.length === 0){ showToast('Сначала добавьте элементы в проект'); return; }
  if(pdfState.busy) return;
  openPdfOptions('project', () => { void buildAndShareProjectPdf(); });
}
async function buildAndShareProjectPdf(): Promise<void> {
  const project = getCurrentProject();
  if(!project || project.elements.length === 0) return;
  if(pdfState.busy) return;
  pdfState.busy = true;
  showToast('Готовлю PDF…');
  try{
    const blob = new Blob([pdfFromJpegs(await buildProjectPdfPages(project))], { type:'application/pdf' });
    await deliverFile(blob, safeFileName(project.name, 'Проект') + '.pdf', project.name);
  }catch(err){
    console.error(err);
    showToast('Не удалось создать PDF');
  }finally{
    pdfState.busy = false;
  }
}
