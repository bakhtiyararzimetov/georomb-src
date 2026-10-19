// Экран «Стёкла и сетки»: список стёкол для стекольщика, москитные сетки, раскрой стекла на листах, PDF.
import { DEFAULT_QTY, S } from '../state.ts';
import type { GlassCutSettings, Project } from '../types.ts';
import { $, $input, escapeHtml, showToast } from '../ui/dom.ts';
import { findGlass, glassSwatchCss } from '../data/glass.ts';
import { projectMat } from '../data/colors.ts';
import { elementGeometry, fmtNum } from '../model/pricing.ts';
import { type SheetPiece, type SheetResult, sheetCut } from '../model/sheetCut.ts';
import { deliverFile } from '../platform/share.ts';
import { getCurrentProject } from '../storage.ts';
import { PDF_GREY, PDF_INK, PDF_LINE, PDF_M, PDF_PH, PDF_PW, type JpegPage, type PdfPage,
         pdfCanvasJpeg, pdfFromJpegs, pdfNewPage, pdfState, pdfText, safeFileName } from './pdf.ts';
import { openPdfOptions, pdfT } from './pdfI18n.ts';
import { parseMm } from '../model/layout.ts';

// ===== настройки раскроя листов =====
const GC_KEY = 'iwd.glassCut.v1';
const GC_DEFAULTS: GlassCutSettings = { sheetW:3210, sheetH:2250, edge:10, gap:2, rotate:true };
function loadGlassCut(): GlassCutSettings {
  const d = { ...GC_DEFAULTS };
  try{
    const s = JSON.parse(localStorage.getItem(GC_KEY) || 'null') as Partial<GlassCutSettings> | null;
    if(s && typeof s === 'object'){
      const num = (v: unknown, min: number, max: number, def: number) => { const n = Number(v); return (isFinite(n) && n >= min && n <= max) ? n : def; };
      d.sheetW = num(s.sheetW, 100, 10000, d.sheetW);
      d.sheetH = num(s.sheetH, 100, 10000, d.sheetH);
      d.edge = num(s.edge, 0, 200, d.edge);
      d.gap = num(s.gap, 0, 50, d.gap);
      if(typeof s.rotate === 'boolean') d.rotate = s.rotate;
    }
  }catch{ /* по умолчанию */ }
  return d;
}
let gc: GlassCutSettings | null = null;
const gcs = (): GlassCutSettings => (gc = gc || loadGlassCut());

// ===== сбор стёкол и сеток проекта =====
interface SizeRow { w: number; h: number; n: number; }
interface GlassGroup { code: string; name: string; swatch: string; rows: SizeRow[]; count: number; area: number; }
interface PaneList { glass: GlassGroup[]; nets: SizeRow[]; netCount: number; netArea: number; }

// одинаковые размеры складываются; сортировка — крупные первыми
function addSize(rows: SizeRow[], w: number, h: number, n: number): void {
  const r = rows.find(x => x.w === w && x.h === h);
  if(r) r.n += n; else rows.push({ w, h, n });
}
const bySize = (a: SizeRow, b: SizeRow) => b.w * b.h - a.w * a.h || b.w - a.w;
export function collectPanes(project: Project): PaneList {
  const mat = projectMat(project);
  const glass: GlassGroup[] = [], nets: SizeRow[] = [];
  project.elements.forEach(e => {
    if(e.type === 'sill') return;
    const q = parseMm(e.qty), qty = Math.max(0, Math.round(Number.isFinite(q) ? q : DEFAULT_QTY));
    if(!qty) return;
    const g = elementGeometry(e, mat);
    const gt = findGlass(e.glass);
    let grp = glass.find(x => x.code === gt.code);
    if(g.glasses.length && !grp){ grp = { code:gt.code, name:gt.name, swatch:'background:' + glassSwatchCss(gt), rows:[], count:0, area:0 }; glass.push(grp); }
    g.glasses.forEach(p => { addSize(grp!.rows, p.w, p.h, qty); grp!.count += qty; grp!.area += p.w * p.h / 1e6 * qty; });
    g.nets.forEach(p => addSize(nets, p.w, p.h, qty));
  });
  glass.forEach(x => x.rows.sort(bySize));
  nets.sort(bySize);
  return {
    glass, nets,
    netCount: nets.reduce((a, r) => a + r.n, 0),
    netArea: nets.reduce((a, r) => a + r.w * r.h / 1e6 * r.n, 0)
  };
}

// ===== экран =====
let glassProjectId: number | null = null;
let glassResults: { code: string; name: string; res: SheetResult }[] | null = null;

const glassProject = (): Project | undefined => S.projects.find(p => p.id === glassProjectId);
export function openGlassScreen(): void {
  const cur = getCurrentProject();
  if(!cur) return;
  if(glassProjectId !== cur.id) glassResults = null;
  glassProjectId = cur.id;
  renderGlassScreen();
  $('glassScreen').classList.add('open');
}
export function closeGlassScreen(): void { $('glassScreen').classList.remove('open'); }

export function glassCutSettingChanged(field: keyof GlassCutSettings): void {
  const s = gcs();
  const el = $input('gc_' + field);
  if(field === 'rotate') s.rotate = el.checked;
  else {
    const v = parseFloat(el.value);
    const lim: Record<string, [number, number]> = { sheetW:[100, 10000], sheetH:[100, 10000], edge:[0, 200], gap:[0, 50] };
    const [min, max] = lim[field];
    if(isFinite(v) && v >= min && v <= max) s[field] = v;
  }
  try{ localStorage.setItem(GC_KEY, JSON.stringify(s)); }catch{ /* без сохранения */ }
  glassResults = null;
  renderGlassScreen();
}
export function calcGlassCut(): void {
  const project = glassProject();
  if(!project) return;
  const list = collectPanes(project);
  const P = gcs();
  glassResults = list.glass.map(g => {
    const pieces: SheetPiece[] = [];
    g.rows.forEach(r => { for(let i = 0; i < r.n; i++) pieces.push({ w:r.w, h:r.h, label:r.w + '×' + r.h }); });
    return { code:g.code, name:g.name, res:sheetCut(pieces, P) };
  });
  renderGlassScreen();
}

// одинаковые листы — одной схемой «× N»
function sheetPatterns(res: SheetResult): { i: number; n: number }[] {
  const out: { i: number; n: number; key: string }[] = [];
  res.sheets.forEach((sh, i) => {
    const key = sh.placed.map(p => `${p.x},${p.y},${p.w},${p.h}`).join(';');
    const ex = out.find(o => o.key === key);
    if(ex) ex.n++; else out.push({ i, n:1, key });
  });
  return out;
}
function sheetSvg(res: SheetResult, i: number): string {
  const P = gcs(), sh = res.sheets[i];
  const fs = Math.round(Math.min(P.sheetW, P.sheetH) / 16);
  const rects = sh.placed.map(p => {
    const label = p.label, fits = p.w > label.length * fs * 0.62 && p.h > fs * 1.4;
    return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#cfe8f5" stroke="#3a7ca5" stroke-width="${fs / 6}"/>`
      + (fits ? `<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + fs * 0.35}" font-size="${fs}" text-anchor="middle" fill="#14213d">${label}${p.rot ? ' ⟲' : ''}</text>` : '');
  }).join('');
  return `<svg class="gc-sheet" viewBox="0 0 ${P.sheetW} ${P.sheetH}" preserveAspectRatio="xMidYMid meet">`
    + `<rect x="0" y="0" width="${P.sheetW}" height="${P.sheetH}" fill="#f3f4f6" stroke="#9aa3ad" stroke-width="${fs / 5}"/>`
    + rects + '</svg>';
}

export function renderGlassScreen(): void {
  const project = glassProject();
  const body = $('glassBody');
  if(!project){ body.innerHTML = '<div class="cut-empty">Проект не выбран.</div>'; return; }
  $('glassTitle').textContent = 'Стёкла и сетки · ' + project.name;
  const list = collectPanes(project);
  if(!list.glass.length && !list.nets.length){
    body.innerHTML = '<div class="cut-empty">В проекте нет стёкол и москитных сеток.</div>';
    return;
  }
  const table = (rows: SizeRow[]) => `
      <div class="est-table">
        <div class="est-head gl-head"><span>Ширина × высота, мм</span><span class="est-num">Шт</span><span class="est-sum">м²</span></div>
        ${rows.map((r, i) => `
        <div class="est-row gl-row${i % 2 ? ' zebra' : ''}">
          <span class="est-name">${r.w} × ${r.h}</span>
          <span class="est-num">${r.n}</span>
          <span class="est-sum">${fmtNum(r.w * r.h / 1e6 * r.n)}</span>
        </div>`).join('')}
      </div>`;
  const glassHtml = list.glass.map(g => `
      <div class="cut-section-title"><span class="color-swatch gl-swatch" style="${g.swatch}"></span>${escapeHtml(g.name)} — ${g.count} шт · ${fmtNum(g.area)} м²</div>
      ${table(g.rows)}`).join('');
  const netsHtml = list.nets.length ? `
      <div class="cut-section-title">Москитные сетки — ${list.netCount} шт · ${fmtNum(list.netArea)} м²</div>
      ${table(list.nets)}` : '';
  const P = gcs();
  const settings = list.glass.length ? `
      <div class="cut-section-title">Раскрой стекла на листах</div>
      <div class="cut-settings">
        <label>Лист, ширина, мм<input id="gc_sheetW" type="number" min="100" step="10" value="${P.sheetW}" onchange="glassCutSettingChanged('sheetW')"></label>
        <label>Лист, высота, мм<input id="gc_sheetH" type="number" min="100" step="10" value="${P.sheetH}" onchange="glassCutSettingChanged('sheetH')"></label>
        <label>Кромка, мм<input id="gc_edge" type="number" min="0" step="1" value="${P.edge}" onchange="glassCutSettingChanged('edge')"></label>
        <label>Рез, мм<input id="gc_gap" type="number" min="0" step="1" value="${P.gap}" onchange="glassCutSettingChanged('gap')"></label>
      </div>
      <label class="cut-check"><input id="gc_rotate" type="checkbox"${P.rotate ? ' checked' : ''} onchange="glassCutSettingChanged('rotate')"> Можно поворачивать стекло (нет узора и направления)</label>
      <button class="btn-block primary" onclick="calcGlassCut()">${glassResults ? 'Пересчитать раскрой стекла' : 'Рассчитать раскрой стекла'}</button>` : '';
  let results = '';
  if(glassResults){
    results = glassResults.map(g => {
      const r = g.res;
      const big = r.tooBig.length ? `<div class="cut-warn">Не помещаются на лист: ${r.tooBig.map(p => p.label).join(', ')} мм</div>` : '';
      const sheets = sheetPatterns(r).map(({ i, n }, k) => `
          <div class="gc-sheet-wrap">
            <div class="cut-stock-label">Лист ${k + 1}${n > 1 ? ` <b>× ${n}</b>` : ''} · занято ${fmtNum(r.sheets[i].usedArea / r.sheetArea * 100, 0, 1)}%</div>
            ${sheetSvg(r, i)}
          </div>`).join('');
      return `
        <div class="cut-result-card">
          <div class="cut-result-title">${escapeHtml(g.name)}</div>
          ${big}
          <div class="cut-result-head">
            <div class="cf"><span class="cf-label">Листов ${P.sheetW}×${P.sheetH}</span><span class="cf-value">${r.sheets.length} шт</span></div>
            <div class="cf"><span class="cf-label">Использование</span><span class="cf-value">${fmtNum(r.usePct, 0, 1)}%</span></div>
            <div class="cf"><span class="cf-label">Стекло</span><span class="cf-value">${fmtNum(r.usedArea / 1e6)} м²</span></div>
            <div class="cf"><span class="cf-label">Отход</span><span class="cf-value">${fmtNum((r.sheets.length * r.sheetArea - r.usedArea) / 1e6)} м²</span></div>
          </div>
          ${sheets}
        </div>`;
    }).join('');
  }
  body.innerHTML = `
      <button class="btn-block ghost" onclick="shareGlassPdf()">PDF для стекольщика</button>
      ${glassHtml}${netsHtml}${settings}${results}`;
}

// ===== PDF для стекольщика =====
export function shareGlassPdf(): void {
  if(!glassProject()) return;
  if(pdfState.busy) return;
  openPdfOptions('other', () => { void buildAndShareGlassPdf(); });
}
async function buildAndShareGlassPdf(): Promise<void> {
  const project = glassProject();
  if(!project || pdfState.busy) return;
  pdfState.busy = true;
  showToast('Готовлю PDF…');
  try{
    const blob = new Blob([pdfFromJpegs(await buildGlassPdfPages(project))], { type:'application/pdf' });
    await deliverFile(blob, 'Стёкла — ' + safeFileName(project.name, 'Проект') + '.pdf', 'Стёкла — ' + project.name);
  }catch(err){
    console.error(err);
    showToast('Не удалось создать PDF');
  }finally{
    pdfState.busy = false;
  }
}
async function buildGlassPdfPages(project: Project): Promise<JpegPage[]> {
  const X0 = PDF_M, X1 = PDF_PW - PDF_M, BOTTOM = PDF_PH - PDF_M, W = X1 - X0;
  const list = collectPanes(project);
  const jpegs: JpegPage[] = [];
  let pg: PdfPage | null = null, y = 0, pageNo = 0;
  const ctx = () => pg!.ctx;
  const flush = async () => { if(pg){ jpegs.push(await pdfCanvasJpeg(pg.c)); pg.c.width = pg.c.height = 0; } };
  const newPage = async () => {
    await flush();
    pg = pdfNewPage(); pageNo++;
    pdfText(ctx(), pdfT('glassTitle') + ' · ' + project.name, X0, 78, 26, { color:PDF_GREY, maxW:820 });
    pdfText(ctx(), pdfT('page') + ' ' + pageNo, X1, 78, 26, { color:PDF_GREY, align:'right' });
    ctx().fillStyle = PDF_LINE; ctx().fillRect(X0, 96, W, 2);
    y = 150;
  };
  const need = async (h: number) => { if(!pg || y + h > BOTTOM) await newPage(); };
  const mm = pdfT('mm'), pcs = pdfT('pcs');
  const cN = X0 + 620, cA = X1;
  const table = async (rows: SizeRow[]) => {
    await need(100);
    pdfText(ctx(), pdfT('wxh') + ', ' + mm, X0, y, 24, { color:PDF_GREY });
    pdfText(ctx(), pcs, cN, y, 24, { color:PDF_GREY, align:'right' });
    pdfText(ctx(), 'м²', cA, y, 24, { color:PDF_GREY, align:'right' });
    y += 14; ctx().fillStyle = PDF_LINE; ctx().fillRect(X0, y, W, 2); y += 40;
    for(let i = 0; i < rows.length; i++){
      await need(46);
      const r = rows[i];
      if(i % 2){ ctx().fillStyle = '#f5f6f8'; ctx().fillRect(X0, y - 32, W, 44); }
      pdfText(ctx(), `${r.w} × ${r.h}`, X0 + 8, y, 30, { bold:true });
      pdfText(ctx(), String(r.n), cN, y, 30, { align:'right' });
      pdfText(ctx(), fmtNum(r.w * r.h / 1e6 * r.n), cA - 8, y, 28, { align:'right', color:PDF_GREY });
      y += 44;
    }
    y += 30;
  };
  await newPage();
  pdfText(ctx(), pdfT('glassTitle'), X0, y, 44, { bold:true });
  y += 50;
  const num = project.number != null ? project.number : project.id;
  pdfText(ctx(), `${pdfT('projectNo')} ${num} · ${new Date().toLocaleDateString('ru-RU')}`, X0, y, 24, { color:PDF_GREY });
  y += 70;
  for(const g of list.glass){
    await need(160);
    pdfText(ctx(), `${pdfT('glasses')}: ${g.name}`, X0, y, 32, { bold:true, maxW:W - 300 });
    pdfText(ctx(), `${g.count} ${pcs} · ${fmtNum(g.area)} м²`, X1, y, 28, { color:PDF_GREY, align:'right' });
    y += 50;
    await table(g.rows);
  }
  if(list.nets.length){
    await need(160);
    pdfText(ctx(), pdfT('nets'), X0, y, 32, { bold:true });
    pdfText(ctx(), `${list.netCount} ${pcs} · ${fmtNum(list.netArea)} м²`, X1, y, 28, { color:PDF_GREY, align:'right' });
    y += 50;
    await table(list.nets);
  }
  // схемы листов — если раскрой посчитан для этого проекта
  if(glassResults && glassProjectId === project.id){
    const P = gcs();
    for(const g of glassResults){
      await need(200);
      pdfText(ctx(), `${pdfT('sheetCut')}: ${g.name}`, X0, y, 32, { bold:true, maxW:W });
      y += 40;
      pdfText(ctx(), `${pdfT('sheet')} ${P.sheetW}×${P.sheetH} ${mm} · ${g.res.sheets.length} ${pdfT('sheets')} · ${pdfT('edge')} ${P.edge} ${mm} · ${pdfT('cut')} ${P.gap} ${mm}`, X0, y, 24, { color:PDF_GREY, maxW:W });
      y += 30;
      if(g.res.tooBig.length){
        pdfText(ctx(), `${pdfT('tooBig')}: ${g.res.tooBig.map(p => p.label).join(', ')} ${mm}`, X0, y + 10, 24, { color:'#b45309', maxW:W });
        y += 34;
      }
      y += 20;
      const sc = W / P.sheetW, sh = P.sheetH * sc;
      for(const [k, { i, n }] of sheetPatterns(g.res).entries()){
        await need(sh + 60);
        pdfText(ctx(), `${pdfT('sheet')} ${k + 1}${n > 1 ? ' × ' + n : ''}`, X0, y + 24, 26, { bold:true });
        y += 40;
        const c = ctx();
        c.fillStyle = '#f3f4f6'; c.fillRect(X0, y, W, sh);
        c.strokeStyle = '#9aa3ad'; c.lineWidth = 2; c.strokeRect(X0, y, W, sh);
        g.res.sheets[i].placed.forEach(p => {
          const x = X0 + p.x * sc, yy = y + p.y * sc, w = p.w * sc, h = p.h * sc;
          c.fillStyle = '#cfe8f5'; c.fillRect(x, yy, w, h);
          c.strokeStyle = '#3a7ca5'; c.lineWidth = 2; c.strokeRect(x, yy, w, h);
          c.font = '600 22px sans-serif';
          if(c.measureText(p.label).width + 8 < w && h > 30) pdfText(c, p.label, x + w / 2, yy + h / 2 + 8, 22, { align:'center', color:PDF_INK, bold:true });
        });
        y += sh + 30;
      }
    }
  }
  await flush();
  return jpegs;
}
