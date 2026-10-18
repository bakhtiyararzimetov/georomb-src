// Каталог цветов (вкладка) и Настройки → «Цвета». Данные — COLOR_OPTIONS, ничего не дублируется.
// HEX не выдумываем: у анодирования EURAS и декоров Renolit HEX не показывается, их цвет — «по образцу».
import { S } from '../state.ts';
import type { ColorOption, Mat } from '../types.ts';
import { $, copyText, escapeHtml, showToast, vibrate } from '../ui/dom.ts';
import { COLOR_OPTIONS, catalogIsOff, projectMat } from '../data/colors.ts';
import { deliverFile, deliverText } from '../platform/share.ts';
import { saveProjects } from '../storage.ts';
import { openProjectScreen } from './projects.ts';
import { openElementForm } from './elementForm.ts';
import {
  PDF_GREY, PDF_LINE, PDF_M, PDF_PW, pdfCanvasJpeg, pdfFromJpegs, pdfLine, pdfNewPage, pdfState, pdfText, type JpegPage
} from './pdf.ts';
import { showTab } from './navigation.ts';

interface CatalogMeta { hexStatus?: string; hexNote?: string; range?: { r: [number, number]; g: [number, number]; b: [number, number] }; bounds?: { brightest: string; darkest: string }; use?: string; }
// Статус HEX для RAL: «точный» — совпадает у 3+ источников; «приблизительный» — расхождение до 5 единиц; иначе ориентировочный
const CATALOG_META: Record<string, CatalogMeta> = {
  ral8017: { hexStatus:'приблизительный', hexNote:'Три источника дают #442F29; HEX в приложении в пределах 5 единиц от них' },
  ral9006: { hexStatus:'приблизительный', hexNote:'Три источника дают #A1A1A0; HEX в приложении в пределах 5 единиц от них',
             range:{ r:[154, 177], g:[157, 178], b:[157, 179] } }
};
const CATALOG_USE = { pvc:'окно · дверь', ral:'фасад · витраж', euras:'фасад · входная группа' };
let catalogMat: Mat = 'pvc';

// ===== Отключённые цвета (общие с выбором цвета элемента) =====
const CATALOG_OFF_KEY = 'iwd.catalogDisabled.v1';
export function loadCatalogOff(): Set<string> {
  try{
    const raw = localStorage.getItem(CATALOG_OFF_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if(Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
  }catch{ /* localStorage недоступен */ }
  return new Set();
}
export function catalogSaveOff(): void {
  try{ localStorage.setItem(CATALOG_OFF_KEY, JSON.stringify([...S.catalogOff])); }catch{ /* без сохранения */ }
}

type Kind = 'euras' | 'ral' | 'renolit' | 'other';
function catalogKind(c: ColorOption): Kind {
  if(c.anodized) return 'euras';
  if(/^RAL/i.test(c.ral || '')) return 'ral';
  if(/^Renolit/i.test(c.ral || '')) return 'renolit';
  return 'other';
}
function catalogRgb(hex: string | null | undefined): number[] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if(!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// тёмный цвет (относительная яркость < 0.12) — пометка про нагрев на солнце (только ПВХ)
function catalogIsDark(hex: string): boolean {
  const rgb = catalogRgb(hex);
  if(!rgb) return false;
  const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]) < 0.12;
}
const catalogName = (c: ColorOption) => String(c.name).replace(/\s*\((?:RAL|EURAS)[^)]*\)\s*$/, '');
function catalogCode(c: ColorOption, kind: Kind): string {
  const parts = String(c.ral || '').split(',').map(x => x.trim());
  if(kind === 'ral' || kind === 'euras') return parts[0];
  if(kind === 'renolit') return String(c.ral).replace(/\s*\(.*\)\s*$/, '');
  return '';
}

function catalogCardHtml(c: ColorOption, mat: Mat, off: boolean): string {
  const kind = catalogKind(c);
  const meta = CATALOG_META[c.code] || {};
  const esc = escapeHtml;
  const parts = String(c.ral || '').split(',').map(x => x.trim());
  const swatchHex = c.hex || c.previewHex || '#cccccc';
  const ph = (t: string) => `<div class="cc-ph">${esc(t)}</div>`;
  const row = (k: string, v: string) => `<div class="cc-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;

  let code: string, near = '';
  if(kind === 'ral' || kind === 'euras' || kind === 'renolit') code = `<div class="cc-code">${esc(catalogCode(c, kind))}</div>`;
  else code = ph('Артикул не указан');
  if(kind === 'renolit'){
    const m = /≈\s*(RAL\s*\d+)/.exec(c.ral);
    if(m) near = row('Ближайший RAL', '≈ ' + m[1]);
  }

  // HEX (у EURAS и Renolit не показываем)
  let hexBlock: string;
  if(kind === 'ral' && c.hex){
    const rgb = catalogRgb(c.hex);
    const st = meta.hexStatus || 'ориентировочный';
    const cls = st === 'точный' ? ' exact' : st === 'приблизительный' ? ' approx' : '';
    hexBlock = `<div><div class="cc-hex">${esc(c.hex.toUpperCase())}</div>`
      + (rgb ? `<div class="cc-rgb">RGB ${rgb.join(' · ')}</div>` : '')
      + `<span class="cc-tag${cls}"${meta.hexNote ? ` title="${esc(meta.hexNote)}"` : ''}>${esc(st)}</span></div>`;
  }else if(kind === 'euras') hexBlock = `<div style="font-size:var(--fs-sm)">Нет HEX — согласовывать по образцу</div>`;
  else hexBlock = ph('HEX не указан');

  // алюминий: диапазон R/G/B (RAL) или границы цвета (анод)
  let extra = '';
  if(mat === 'alu'){
    if(kind === 'ral'){
      const r = meta.range;
      extra = r ? `<div><div class="cc-rgb" style="margin:0">Диапазон R / G / B</div><div style="font-size:var(--fs-xs)">R ${r.r[0]}–${r.r[1]} · G ${r.g[0]}–${r.g[1]} · B ${r.b[0]}–${r.b[1]}</div></div>`
                : ph('Диапазон R / G / B — заполнить по источникам');
    }else if(kind === 'euras'){
      const b = meta.bounds;
      extra = b ? row('Границы цвета', `brightest ${b.brightest} · darkest ${b.darkest}`)
                : `<div class="cc-ph">Границы цвета (brightest / darkest)<br>brightest — не задано<br>darkest — не задано</div>`;
    }
  }

  const coatFull = mat === 'pvc' ? 'ламинация' : parts.slice(1).join(', ');
  const [coating, coatHint] = coatFull.split(/\s+—\s+/);
  const use = meta.use || (mat === 'pvc' ? CATALOG_USE.pvc : (kind === 'euras' ? CATALOG_USE.euras : CATALOG_USE.ral));
  const rows = (coating ? row('Покрытие', coating) : ph('Покрытие не указано'))
    + (coatHint ? `<div class="cc-rgb" style="margin:-4px 0 0">${esc(coatHint)}</div>` : '')
    + row('Применение', use);

  const dark = (mat === 'pvc' && catalogIsDark(swatchHex))
    ? `<div class="cc-note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Тёмный цвет — нагрев на солнце</div>`
    : '';
  const conditional = (kind === 'ral' && c.hex) ? '' : `<span class="cc-pill" style="bottom:8px">Условный цвет — по образцу</span>`;
  const offPill = off ? `<span class="cc-pill" style="top:8px; right:8px; left:auto">Отключён</span>` : '';
  return `<div class="cc-card${off ? ' off' : ''}" data-code="${esc(c.code)}">
      <div class="cc-sw" style="background:${esc(swatchHex)}"><span class="cc-pill" style="top:8px">${mat === 'pvc' ? 'ПВХ' : 'Алюминий'}</span>${conditional}${offPill}</div>
      <div class="cc-body">
        <div>${code}<div class="cc-name">${esc(catalogName(c))}</div></div>
        ${hexBlock}${near}${extra}${rows}${dark}
        ${off ? `<button class="cc-btn main" disabled>Отключён</button>`
              : `<button class="cc-btn main" onclick="catalogAddToProject('${esc(c.code)}')">Добавить в проект</button>`}
      </div>
    </div>`;
}

export function renderCatalog(): void {
  const list = COLOR_OPTIONS[catalogMat] || [];
  $('ccSegPvc').classList.toggle('on', catalogMat === 'pvc');
  $('ccSegAlu').classList.toggle('on', catalogMat === 'alu');
  const on = list.filter(c => !catalogIsOff(catalogMat, c.code));
  const off = list.filter(c => catalogIsOff(catalogMat, c.code));
  $('catalogGrid').innerHTML = list.length
    ? on.map(c => catalogCardHtml(c, catalogMat, false)).join('')
      + (off.length ? '<div class="cc-divider">Отключённые</div>' + off.map(c => catalogCardHtml(c, catalogMat, true)).join('') : '')
    : '<div class="empty">Цветов пока нет.</div>';
}
function catalogToggle(code: string): void {
  if(!(COLOR_OPTIONS[catalogMat] || []).some(x => x.code === code)) return;
  const key = catalogMat + ':' + code;
  const nowOff = !S.catalogOff.has(key);
  if(nowOff) S.catalogOff.add(key); else S.catalogOff.delete(key);
  catalogSaveOff();
  renderCatalog();
  showToast(nowOff ? 'Цвет отключён' : 'Цвет включён');
  vibrate(12);
}
// долгое нажатие на карточку — включить/отключить цвет
export function initCatalogLongPress(): void {
  const grid = $('catalogGrid');
  const HOLD_MS = 500, MOVE_TOL = 10;
  let timer: ReturnType<typeof setTimeout> | null = null, start: { x: number; y: number } | null = null, fired = false;
  const cancel = () => { if(timer) clearTimeout(timer); timer = null; start = null; };
  const cardOf = (t: EventTarget | null) => (t instanceof Element) ? t.closest('.cc-card') : null;
  const fire = (code: string) => { fired = true; catalogToggle(code); };
  grid.addEventListener('pointerdown', ev => {
    fired = false;
    if(ev.pointerType === 'mouse' && ev.button !== 0) return;
    const card = cardOf(ev.target);
    if(!card) return;
    const code = card.getAttribute('data-code') || '';
    cancel();
    start = { x:ev.clientX, y:ev.clientY };
    timer = setTimeout(() => { timer = null; fire(code); }, HOLD_MS);
  });
  grid.addEventListener('pointermove', ev => {
    if(!start) return;
    if(Math.abs(ev.clientX - start.x) > MOVE_TOL || Math.abs(ev.clientY - start.y) > MOVE_TOL) cancel();
  });
  (['pointerup', 'pointercancel'] as const).forEach(type => document.addEventListener(type, () => {
    cancel();
    if(fired) setTimeout(() => { fired = false; }, 400);
  }));
  // после долгого нажатия отпускание не должно нажать «Добавить в проект»
  grid.addEventListener('click', ev => { if(fired){ ev.stopPropagation(); ev.preventDefault(); } }, true);
  grid.addEventListener('contextmenu', ev => {
    const card = cardOf(ev.target);
    if(!card) return;
    ev.preventDefault();
    if(!fired) fire(card.getAttribute('data-code') || '');
  });
}

// ===== «Поделиться» каталогом: PDF, запасной вариант — текст / буфер / файл =====
function catalogShareLine(c: ColorOption, mat: Mat, n: number): string {
  const kind = catalogKind(c);
  const parts = String(c.ral || '').split(',').map(x => x.trim());
  const code = catalogCode(c, kind);
  const bits: string[] = [];
  if(code) bits.push(code);
  bits.push(catalogName(c));
  if(kind === 'ral' && c.hex) bits.push(c.hex.toUpperCase());
  if(mat === 'alu'){
    const coat = parts.slice(1).join(', ').split(/\s+—\s+/)[0];
    if(coat) bits.push(coat);
  }
  return n + '. ' + bits.join(' — ');
}
const enabledColors = (mat: Mat) => (COLOR_OPTIONS[mat] || []).filter(c => !catalogIsOff(mat, c.code));
async function shareCatalogText(): Promise<void> {
  const blocks: string[] = [];
  ([['pvc', 'ПВХ'], ['alu', 'Алюминий']] as [Mat, string][]).forEach(([mat, title]) => {
    const on = enabledColors(mat);
    if(on.length) blocks.push(title + '\n' + on.map((c, i) => catalogShareLine(c, mat, i + 1)).join('\n'));
  });
  if(!blocks.length){ showToast('Нет доступных цветов'); return; }
  const text = 'Каталог цветов\n\n' + blocks.join('\n\n');
  const how = await deliverText(text, 'Каталог цветов');
  if(how === 'native' || how === 'share' || how === 'cancel') return;
  if(await copyText(text)){ showToast('Каталог скопирован'); return; }
  try{
    const blob = new Blob([text], { type:'text/plain;charset=utf-8' });
    const fileHow = await deliverFile(blob, 'Каталог цветов.txt', 'Каталог цветов');
    if(fileHow === 'download') showToast('Каталог сохранён в файл');
  }catch{ showToast('Не удалось поделиться'); }
}
const CAT_PDF_PER_PAGE = 8;
function catPdfRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function catPdfDrawCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: ColorOption, mat: Mat): void {
  const kind = catalogKind(c);
  const parts = String(c.ral || '').split(',').map(p => p.trim());
  const code = catalogCode(c, kind), name = catalogName(c);
  const coat = mat === 'pvc' ? 'ламинация' : parts.slice(1).join(', ').split(/\s+—\s+/)[0];
  const hasHex = kind === 'ral' && !!c.hex;
  const swH = 150;
  ctx.save();
  catPdfRoundRect(ctx, x, y, w, h, 16); ctx.clip();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = c.hex || c.previewHex || '#cccccc'; ctx.fillRect(x, y, w, swH);
  ctx.restore();
  ctx.strokeStyle = PDF_LINE; ctx.lineWidth = 2;
  catPdfRoundRect(ctx, x, y, w, h, 16); ctx.stroke();
  pdfLine(ctx, x, y + swH, x + w, y + swH);
  const tx = x + 26, maxW = w - 52;
  let ty = y + swH + 50;
  pdfText(ctx, code || name, tx, ty, 36, { bold:true, maxW });
  if(code){ ty += 38; pdfText(ctx, name, tx, ty, 28, { color:PDF_GREY, maxW }); }
  ty += 42;
  if(hasHex) pdfText(ctx, c.hex!.toUpperCase(), tx, ty, 28, { maxW });
  else pdfText(ctx, 'Условный цвет — по образцу', tx, ty, 24, { color:PDF_GREY, maxW });
  if(coat){ ty += 38; pdfText(ctx, 'Покрытие: ' + coat, tx, ty, 24, { color:PDF_GREY, maxW }); }
}
async function buildCatalogPdfPages(): Promise<JpegPage[]> {
  const pagesData: { mat: Mat; title: string; items: ColorOption[] }[] = [];
  ([['pvc', 'ПВХ'], ['alu', 'Алюминий']] as [Mat, string][]).forEach(([mat, title]) => {
    const on = enabledColors(mat);
    for(let i = 0; i < on.length; i += CAT_PDF_PER_PAGE) pagesData.push({ mat, title, items:on.slice(i, i + CAT_PDF_PER_PAGE) });
  });
  const jpegs: JpegPage[] = [];
  for(let n = 0; n < pagesData.length; n++){
    const pg = pdfNewPage(), ctx = pg.ctx, d = pagesData[n];
    pdfText(ctx, 'Каталог цветов  ·  ' + d.title, PDF_M, 78, 26, { color:PDF_GREY, maxW:800 });
    pdfText(ctx, (n + 1) + ' / ' + pagesData.length, PDF_PW - PDF_M, 78, 26, { color:PDF_GREY, align:'right' });
    ctx.fillStyle = PDF_LINE; ctx.fillRect(PDF_M, 96, PDF_PW - 2*PDF_M, 2);
    const gap = 30, cw = (PDF_PW - 2*PDF_M - gap) / 2, ch = 340;
    d.items.forEach((c, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      catPdfDrawCard(ctx, PDF_M + col * (cw + gap), 140 + row * (ch + gap), cw, ch, c, d.mat);
    });
    jpegs.push(await pdfCanvasJpeg(pg.c));
    pg.c.width = pg.c.height = 0;
  }
  return jpegs;
}
export async function shareCatalog(): Promise<void> {
  if(!(['pvc', 'alu'] as Mat[]).some(mat => enabledColors(mat).length)){ showToast('Нет доступных цветов'); return; }
  if(pdfState.busy) return;
  pdfState.busy = true;
  showToast('Готовлю PDF…');
  let blob: Blob | null = null;
  try{
    blob = new Blob([pdfFromJpegs(await buildCatalogPdfPages())], { type:'application/pdf' });
  }catch(err){
    console.error(err);
  }finally{
    pdfState.busy = false;
  }
  if(!blob){ await shareCatalogText(); return; }      // PDF не собрался — текстом
  try{
    const how = await deliverFile(blob, 'Каталог цветов.pdf', 'Каталог цветов');
    if(how === 'download') showToast('Файл сохранён: Каталог цветов.pdf');
  }catch(err){
    console.error(err);
    await shareCatalogText();
  }
}
export function setCatalogMat(mat: string): void {
  catalogMat = (mat === 'alu') ? 'alu' : 'pvc';
  renderCatalog();
  (document.querySelector('#catalogScreen .screen-body') as HTMLElement).scrollTop = 0;
}
export function openCatalog(): void {
  renderCatalog();
  showTab('catalog');
}
export function closeCatalog(): void { showTab(null); }

// «Добавить в проект»: проект того же материала → project.defaultColor, сразу форма нового элемента
let catalogPendingCode: string | null = null;
export function catalogAddToProject(code: string): void {
  const c = (COLOR_OPTIONS[catalogMat] || []).find(x => x.code === code);
  if(!c) return;
  const list = S.projects.filter(p => projectMat(p) === catalogMat);
  if(!list.length){
    showToast(catalogMat === 'alu' ? 'Нет проектов из алюминия. Сначала создайте проект' : 'Нет проектов из ПВХ. Сначала создайте проект');
    return;
  }
  catalogPendingCode = code;
  $('catalogProjectColor').textContent = c.name;
  $('catalogProjectList').innerHTML = list.map(p => `
      <button class="color-opt${p.defaultColor === code ? ' selected' : ''}" onclick="catalogPickProject(${p.id})">
        <span class="avatar" style="width:34px;height:34px;font-size:var(--fs-sm)">${escapeHtml(String(p.number != null ? p.number : p.id))}</span>
        <span>${escapeHtml(p.name)}</span>
        <span class="check">✓</span>
      </button>`).join('');
  $('catalogProjectBackdrop').classList.add('open');
}
export function closeCatalogProjectPicker(): void {
  $('catalogProjectBackdrop').classList.remove('open');
  catalogPendingCode = null;
}
export function catalogPickProject(id: number): void {
  const project = S.projects.find(p => p.id === id);
  const c = (COLOR_OPTIONS[catalogMat] || []).find(x => x.code === catalogPendingCode);
  if(!project || !c){ closeCatalogProjectPicker(); return; }
  project.defaultColor = c.code;
  saveProjects();
  closeCatalogProjectPicker();
  openProjectScreen(project);
  openElementForm();
}

// ===== Настройки → «Цвета»: переключатели вкл/выкл =====
let colorSettingMat: Mat = 'pvc';
function renderColorSetting(): void {
  $('csTabPvc').classList.toggle('on', colorSettingMat === 'pvc');
  $('csTabAlu').classList.toggle('on', colorSettingMat === 'alu');
  const list = COLOR_OPTIONS[colorSettingMat] || [];
  $('colorSettingBody').innerHTML =
    '<div class="section-label">Отключённые цвета не показываются при выборе цвета элемента</div>'
    + list.map(c => {
      const off = catalogIsOff(colorSettingMat, c.code);
      return `<label class="cs-row${off ? ' off' : ''}">
          <span class="color-swatch${c.metallic ? ' metallic' : ''}${c.anodized ? ' anodized' : ''}" style="background-color:${c.hex || c.previewHex}"></span>
          <span class="cs-name">${escapeHtml(c.name)}${c.anodized ? ' — образец' : ''}</span>
          <input class="cs-switch" type="checkbox" ${off ? '' : 'checked'} onchange="colorSettingToggle('${colorSettingMat}', '${c.code}', this)">
        </label>`;
    }).join('');
}
export function colorSettingToggle(mat: Mat, code: string, input: HTMLInputElement): void {
  const key = mat + ':' + code;
  if(input.checked) S.catalogOff.delete(key); else S.catalogOff.add(key);
  catalogSaveOff();
  const row = input.closest('.cs-row');
  if(row) row.classList.toggle('off', !input.checked);
  if($('catalogScreen').classList.contains('open')) renderCatalog();
}
export function setColorSettingMat(mat: string): void {
  colorSettingMat = (mat === 'alu') ? 'alu' : 'pvc';
  renderColorSetting();
  $('colorSettingBody').scrollTop = 0;
}
export function openColorSetting(): void {
  renderColorSetting();
  $('colorSettingScreen').classList.add('open');
}
export function closeColorSetting(): void { $('colorSettingScreen').classList.remove('open'); }
