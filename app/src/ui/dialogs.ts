// Общие диалоги: подтверждение, резюме, выбор цвета рамы и стекла.
import type { Project } from '../types.ts';
import { $, $select, escapeHtml } from './dom.ts';
import { colorHex, colorsForProject, findColor, pickableColors } from '../data/colors.ts';
import { GLASS_TYPES, findGlass, glassSwatchCss } from '../data/glass.ts';
import { getCurrentProject } from '../storage.ts';

// ===== Подтверждение =====
let confirmCallback: (() => void) | null = null;
/** okLabel — надпись на кнопке подтверждения (по умолчанию «Удалить»). */
export function openConfirm(text: string, onOk: () => void, okLabel = 'Удалить'): void {
  $('confirmTitle').textContent = text;
  $('confirmOkBtn').textContent = okLabel;
  confirmCallback = onOk;
  $('confirmBackdrop').classList.add('open');
}
export function closeConfirm(): void {
  $('confirmBackdrop').classList.remove('open');
  confirmCallback = null;
}
export function runConfirm(): void {
  const cb = confirmCallback;
  closeConfirm();
  if(cb) cb();
}

// ===== Резюме (список строк «название — значение») =====
export function openSummaryRows(title: string, rows: [string, unknown][]): void {
  $('summaryTitle').textContent = title;
  $('summaryBody').innerHTML = rows.map(([label, value]) => `
      <div class="summary-row">
        <div class="label">${escapeHtml(String(label))}</div>
        <div class="value">${escapeHtml(String(value))}</div>
      </div>
    `).join('');
  $('summaryBackdrop').classList.add('open');
}
export function closeSummary(): void { $('summaryBackdrop').classList.remove('open'); }

// ===== Выбор цвета рамы =====
// заполняет <select> цветов проекта и подсвечивает кружок
export function fillColorSelect(selectId: string, swatchId: string, project: Project | null | undefined, selectedCode: string | null | undefined): void {
  const sel = $select(selectId);
  const colors = pickableColors(project, selectedCode);
  if(colors.length === 0){
    sel.innerHTML = `<option value="">Цвета не заданы</option>`;
    sel.disabled = true;
  }else{
    sel.disabled = false;
    sel.innerHTML = colors.map(c =>
      `<option value="${c.code}">${escapeHtml(c.name)}${c.anodized ? ' — образец' : ''}</option>`
    ).join('');
    // без выбранного цвета — первый по порядку каталога (белый), а не самый частый
    const firstByCatalog = colorsForProject(project).find(c => colors.includes(c)) || colors[0];
    sel.value = colors.some(c => c.code === selectedCode) ? selectedCode! : firstByCatalog.code;
  }
  updateColorSwatch(selectId, swatchId, project);
}
export function updateColorSwatch(selectId: string, swatchId: string, project: Project | null | undefined): void {
  const sel = $select(selectId);
  const swatch = $(swatchId);
  const c = findColor(project, sel.value);
  swatch.style.display = c ? 'inline-block' : 'none';
  swatch.classList.toggle('anodized', !!(c && c.anodized));
  swatch.classList.toggle('metallic', !!(c && c.metallic));
  swatch.style.background = c ? colorHex(c) : 'transparent';
  swatch.title = c && c.anodized ? 'Анодирование: точный цвет только по физическому образцу, зависит от партии и сплава' : '';
}

// ===== Стекло =====
export function fillGlassSelect(selectId: string, swatchId: string, selectedCode: string | null | undefined): void {
  const sel = $select(selectId);
  sel.disabled = false;
  sel.innerHTML = GLASS_TYPES.map(g => `<option value="${g.code}">${escapeHtml(g.name)}</option>`).join('');
  sel.value = findGlass(selectedCode).code;
  updateGlassSwatch(selectId, swatchId);
}
export function updateGlassSwatch(selectId: string, swatchId: string): void {
  const g = findGlass($select(selectId).value);
  const sw = $(swatchId);
  sw.style.display = 'inline-block';
  sw.style.background = glassSwatchCss(g);
  sw.title = g.desc;
}

// ===== Шторка со списком (общая для рамы и стекла) =====
let colorPickTarget: { selectId: string; swatchId: string } | null = null;
function openPickList(title: string, html: string): void {
  $('colorPickTitle').textContent = title;
  $('colorPickList').innerHTML = html;
  $('colorPickBackdrop').classList.add('open');
  const cur = document.querySelector('#colorPickList .selected');
  if(cur) cur.scrollIntoView({ block:'center' });
}
export function openGlassPicker(selectId: string, swatchId: string): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if(!sel) return;
  colorPickTarget = { selectId, swatchId };
  openPickList('Цвет окна', GLASS_TYPES.map(g => `
      <button class="color-opt${g.code === sel.value ? ' selected' : ''}" onclick="pickColor('${g.code}')">
        <span class="color-swatch" style="background:${glassSwatchCss(g)}"></span>
        <span>${escapeHtml(g.name)}</span>
        <span class="check">✓</span>
      </button>`).join(''));
}
export function openColorPicker(selectId: string, swatchId: string): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  const colors = pickableColors(getCurrentProject(), sel ? sel.value : null);
  if(!sel || sel.disabled || !colors.length) return;
  colorPickTarget = { selectId, swatchId };
  openPickList('Цвет рамы', colors.map(c => `
      <button class="color-opt${c.code === sel.value ? ' selected' : ''}" onclick="pickColor('${c.code}')">
        <span class="color-swatch${c.metallic ? ' metallic' : ''}${c.anodized ? ' anodized' : ''}" style="background-color:${colorHex(c)}"></span>
        <span>${escapeHtml(c.name)}${c.anodized ? ' — образец' : ''}</span>
        <span class="check">✓</span>
      </button>`).join(''));
}
export function closeColorPicker(): void {
  $('colorPickBackdrop').classList.remove('open');
  colorPickTarget = null;
}
export function pickColor(code: string): void {
  if(!colorPickTarget) return;
  const sel = $select(colorPickTarget.selectId);
  sel.value = code;
  sel.dispatchEvent(new Event('change'));   // обновит кружок через onchange
  closeColorPicker();
}
