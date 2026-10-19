// Склад остатков профиля — перенос WarehouseProfileMatcher (Android romchi). Совместимость остатка с деталью —
// по материалу, роли профиля и цвету (без учёта регистра). Ключ хранения не меняется.
import { S } from '../state.ts';
import type { Mat, Remnant } from '../types.ts';
import { $, $input, $select, escapeHtml, parseSize, showToast } from '../ui/dom.ts';
import { COLOR_OPTIONS, colorHex } from '../data/colors.ts';
import { CUT_ROLE_LABEL, extractCuttingGroups } from './cutting.ts';
import { showTab } from './navigation.ts';
import { notifyDataChanged } from '../storage.ts';

// длины нового хлыста, если подходящего остатка нет (справочно)
const WH_STOCK_LENGTHS = [6000, 6500];

interface WhEntry { material: Mat; role: string; color: string; lengthMm: number; }
export interface RemnantUse { piecesPerUnit: number; totalPieces: number; usedUnits: number; leftoverMm: number; }

export class WarehouseMatcher {
  kerfThickness: number;   // пропил, мм
  constructor(kerfThickness = 5){ this.kerfThickness = kerfThickness; }
  // сравнение без регистра и лишних пробелов — как equalsIgnoreCase в Kotlin
  norm(s: unknown): string { return String(s == null ? '' : s).trim().toLowerCase(); }
  isCompatible(tool: WhEntry | null, entry: Remnant | null): boolean {
    if(!tool || !entry) return false;
    return this.norm(tool.material) === this.norm(entry.material)
        && this.norm(tool.role)     === this.norm(entry.role)
        && this.norm(tool.color)    === this.norm(entry.color);
  }
  findMatches(entry: WhEntry, warehouse: Remnant[]): Remnant[] {
    return (warehouse || []).filter(remnant => this.isCompatible(entry, remnant));
  }
  // сколько деталей влезет в остаток с учётом пропила (n·len + (n−1)·kerf ≤ остаток) и что останется
  useRemnant(entry: WhEntry, remnant: Remnant, kerf?: number): RemnantUse {
    const k = Number.isFinite(kerf) ? kerf! : this.kerfThickness;
    const pieceLen = Number(entry && entry.lengthMm) || 0;
    const stockLen = Number(remnant && remnant.lengthMm) || 0;
    const stockQty = Math.max(0, Number(remnant && remnant.qty) || 0);
    if(pieceLen <= 0 || stockLen <= 0) return { piecesPerUnit:0, totalPieces:0, usedUnits:0, leftoverMm:stockLen };
    const piecesPerUnit = Math.max(0, Math.floor((stockLen + k) / (pieceLen + k)));
    const leftoverMm = piecesPerUnit > 0 ? stockLen - (piecesPerUnit * pieceLen + (piecesPerUnit - 1) * k) : stockLen;
    return { piecesPerUnit, totalPieces: piecesPerUnit * stockQty, usedUnits: piecesPerUnit > 0 ? stockQty : 0, leftoverMm };
  }
}

const WH_STORAGE_KEY = 'iwd.warehouse.v1';
const WH_MAT_LABEL: Record<Mat, string> = { pvc:'ПВХ', alu:'Алюминий' };
export const WH_NO_COLOR = 'Без цвета';
let whMat: Mat = 'pvc';
export const wh = { matcher: new WarehouseMatcher(5) };

// старые остатки без material/role получают ПВХ и «Рама»
export function whNormalizeRemnant(r: Partial<Remnant> & { id: number }): Remnant {
  return {
    id: r.id, material: r.material === 'alu' ? 'alu' : 'pvc',
    role: r.role && CUT_ROLE_LABEL[r.role] ? r.role : 'frame',
    color: String(r.color || '').trim() || WH_NO_COLOR,
    lengthMm: Number(r.lengthMm), qty: Number(r.qty)
  };
}
export function loadWarehouse(): void {
  try{
    const raw = localStorage.getItem(WH_STORAGE_KEY);
    if(raw){
      const d = JSON.parse(raw) as { remnants?: unknown; kerfThickness?: unknown; nextId?: unknown };
      if(d && Array.isArray(d.remnants)){
        S.warehouseRemnants = d.remnants.filter((r): r is Remnant => !!r && typeof r === 'object').map(whNormalizeRemnant);
        wh.matcher = new WarehouseMatcher(Number(d.kerfThickness) > 0 ? Number(d.kerfThickness) : 5);
        S.whNextId = Number(d.nextId) > 0 ? Number(d.nextId) : (S.warehouseRemnants.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1);
        return;
      }
    }
  }catch{ /* недоступно или повреждено — пустой склад */ }
  S.warehouseRemnants = [];
  wh.matcher = new WarehouseMatcher(5);
  S.whNextId = 1;
}
export function saveWarehouse(): void {
  try{
    localStorage.setItem(WH_STORAGE_KEY, JSON.stringify({
      kerfThickness: wh.matcher.kerfThickness, remnants: S.warehouseRemnants, nextId: S.whNextId
    }));
  }catch{ /* без сохранения */ }
  notifyDataChanged();
}

// списки выбора: роли профиля и цвета каталога (+ «Без цвета»)
const whColorNames = (mat: Mat) => [WH_NO_COLOR].concat((COLOR_OPTIONS[mat] || []).map(c => c.name));
function fillWhSelects(): void {
  const roleHtml = Object.keys(CUT_ROLE_LABEL).filter(k => k !== 'sill').map(k => `<option value="${k}">${escapeHtml(CUT_ROLE_LABEL[k])}</option>`).join('');
  const colorHtml = whColorNames(whMat).map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  ['whRole', 'whsRole'].forEach(id => { $(id).innerHTML = roleHtml; });
  ['whColor', 'whsColor'].forEach(id => { $(id).innerHTML = colorHtml; });
}
// выбрать значение; нет в списке (старый остаток) — добавить пунктом
function whSetSelect(id: string, value: string): void {
  const sel = $select(id);
  if(![...sel.options].some(o => o.value === value)){
    const o = document.createElement('option'); o.value = value; o.textContent = value; sel.appendChild(o);
  }
  sel.value = value;
  whUpdateSwatch(id);
}
const whColorInfo = (name: string) => (COLOR_OPTIONS[whMat] || []).find(c => c.name === name) || null;
function whUpdateSwatch(id: string): void {
  const sw = document.getElementById(id + 'Swatch');
  if(!sw) return;
  const c = whColorInfo($select(id).value);
  sw.classList.toggle('metallic', !!(c && c.metallic));
  sw.classList.toggle('anodized', !!(c && c.anodized));
  sw.style.background = c ? colorHex(c) : '#ffffff';
}
// выбор профиля/цвета шторкой со списком
let whPickerTarget: string | null = null;
export function openWhPicker(id: string): void {
  const sel = $select(id);
  const isColor = !!document.getElementById(id + 'Swatch');
  whPickerTarget = id;
  $('whPickerTitle').textContent = isColor ? 'Цвет' : 'Профиль';
  $('whPickerList').innerHTML = [...sel.options].map((o, i) => {
    const c = isColor ? whColorInfo(o.value) : null;
    const sw = isColor ? `<span class="color-swatch${c && c.metallic ? ' metallic' : ''}${c && c.anodized ? ' anodized' : ''}" style="background-color:${c ? colorHex(c) : '#ffffff'}"></span>` : '';
    return `<button class="color-opt${o.value === sel.value ? ' selected' : ''}" onclick="whPickerChoose(${i})">${sw}<span>${escapeHtml(o.textContent)}${c && c.anodized ? ' — образец' : ''}</span><span class="check">✓</span></button>`;
  }).join('');
  $('whPickerBackdrop').classList.add('open');
  const cur = document.querySelector('#whPickerList .selected');
  if(cur) cur.scrollIntoView({ block:'center' });
}
export function closeWhPicker(): void {
  $('whPickerBackdrop').classList.remove('open');
  whPickerTarget = null;
}
export function whPickerChoose(i: number): void {
  if(!whPickerTarget) return;
  const sel = $select(whPickerTarget);
  if(sel.options[i]) whSetSelect(whPickerTarget, sel.options[i].value);
  closeWhPicker();
}
export function whSetMat(m: string): void {
  whMat = m === 'alu' ? 'alu' : 'pvc';
  whLastEntry = null; whLastResults = null;
  renderWarehouseScreen();
}

let whEditId: number | null = null;   // редактируемый остаток или null — новый
let whLastResults: { remnant: Remnant; use: RemnantUse }[] | null = null;
let whLastEntry: WhEntry | null = null;

export function renderWarehouseScreen(): void {
  const settingsHtml = `
      <div class="cut-settings">
        <label>Пропил, мм
          <input id="whKerf" type="number" min="1" step="1" value="${wh.matcher.kerfThickness}" onchange="whKerfChanged()">
        </label>
      </div>`;
  const actionsHtml = `
      <button class="btn-block primary compact" onclick="openWhAdd()">Добавить остаток</button>
      <button class="wh-find-btn" onclick="openWhSearch()">Найти подходящие</button>`;
  const tabsHtml = `<div class="wh-mat-tabs">${(['pvc','alu'] as Mat[]).map(m => `<button class="${m === whMat ? 'active' : ''}" onclick="whSetMat('${m}')">${WH_MAT_LABEL[m]}</button>`).join('')}</div>`;
  const items = S.warehouseRemnants.filter(r => r.material === whMat);
  const listHtml = items.length === 0
    ? `<div class="cut-empty">Остатков пока нет.<br>Нажмите «Добавить остаток».</div>`
    : `<div class="cut-section-title">Остатки на складе</div><div class="wh-list">${
        items.map(r => `
            <div class="wh-row" onclick="openWhAdd(${r.id})">
              <div class="wh-main">
                <div class="wh-title">${escapeHtml(CUT_ROLE_LABEL[r.role] || r.role)}</div>
                <div class="wh-sub">${escapeHtml(r.color || '—')}</div>
              </div>
              <div>
                <div class="wh-len">${r.lengthMm} мм</div>
                <div class="wh-qty">${escapeHtml(r.qty)} шт</div>
              </div>
              <button class="wh-del" aria-label="Удалить" onclick="event.stopPropagation(); deleteWhRemnant(${r.id})">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
            </div>`).join('')
      }</div>`;
  $('warehouseBody').innerHTML = tabsHtml + settingsHtml + actionsHtml + listHtml + renderWhResultsHtml();
}
export function whKerfChanged(): void {
  const v = parseFloat($input('whKerf').value);
  wh.matcher.kerfThickness = v > 0 ? v : wh.matcher.kerfThickness;
  saveWarehouse();
  if(whLastEntry) runWhMatch(whLastEntry);   // пересчитать результаты с новым пропилом
  else renderWarehouseScreen();
}
export function openWarehouse(): void {
  showTab('warehouse');
  renderWarehouseScreen();
}
export function closeWarehouse(): void { showTab(null); }

// --- добавление / редактирование остатка ---
export function openWhAdd(id?: number): void {
  whEditId = Number.isFinite(id) ? id! : null;
  const r = whEditId != null ? S.warehouseRemnants.find(x => x.id === whEditId) : null;
  $('whAddTitle').textContent = (r ? 'Редактировать остаток' : 'Добавить остаток') + ' · ' + WH_MAT_LABEL[whMat];
  fillWhSelects();
  whSetSelect('whRole', r ? r.role : 'frame');
  whSetSelect('whColor', r ? r.color : WH_NO_COLOR);
  $input('whLength').value = r ? String(r.lengthMm) : '';
  $input('whQty').value    = r ? String(r.qty) : '1';
  $('whAddBackdrop').classList.add('open');
}
export function closeWhAdd(): void {
  $('whAddBackdrop').classList.remove('open');
  whEditId = null;
}
export function saveWhRemnant(): void {
  const role = $select('whRole').value;
  const color = $select('whColor').value;
  const lengthMm = parseSize($input('whLength').value);
  const qty = parseSize($input('whQty').value);
  if(!role || !color){ showToast('Выберите профиль и цвет'); return; }
  if(!isFinite(lengthMm)){ showToast('Укажите длину остатка'); return; }
  if(!isFinite(qty)){ showToast('Укажите количество'); return; }
  if(whEditId != null){
    const r = S.warehouseRemnants.find(x => x.id === whEditId);
    if(r) Object.assign(r, { role, color, lengthMm: Math.round(lengthMm), qty: Math.round(qty) });
  }else{
    S.warehouseRemnants.push({ id: S.whNextId++, material: whMat, role, color, lengthMm: Math.round(lengthMm), qty: Math.round(qty) });
  }
  saveWarehouse();
  closeWhAdd();
  renderWarehouseScreen();
  showToast('Остаток сохранён');
}
export function deleteWhRemnant(id: number): void {
  S.warehouseRemnants = S.warehouseRemnants.filter(r => r.id !== id);
  saveWarehouse();
  renderWarehouseScreen();
}

// --- поиск подходящих остатков под деталь ---
export function openWhSearch(): void {
  fillWhSelects();
  whSetSelect('whsRole', 'frame');
  whSetSelect('whsColor', WH_NO_COLOR);
  $input('whsLength').value = '';
  $('whSearchBackdrop').classList.add('open');
}
export function closeWhSearch(): void { $('whSearchBackdrop').classList.remove('open'); }
export function runWhSearch(): void {
  const entry: WhEntry = {
    material: whMat, role: $select('whsRole').value, color: $select('whsColor').value,
    lengthMm: parseSize($input('whsLength').value)
  };
  if(!isFinite(entry.lengthMm)){ showToast('Укажите требуемую длину детали'); return; }
  closeWhSearch();
  runWhMatch(entry);
}
function runWhMatch(entry: WhEntry): void {
  whLastEntry = entry;
  whLastResults = wh.matcher.findMatches(entry, S.warehouseRemnants)
    .map(remnant => ({ remnant, use: wh.matcher.useRemnant(entry, remnant, wh.matcher.kerfThickness) }))
    .filter(({ use }) => use.piecesPerUnit > 0)
    .sort((a, b) => a.use.leftoverMm - b.use.leftoverMm);   // сначала — с наименьшим отходом
  renderWarehouseScreen();
}
function renderWhResultsHtml(): string {
  if(!whLastEntry) return '';
  const e = whLastEntry;
  const header = `
      <div class="cut-section-title">Результат поиска: ${escapeHtml(WH_MAT_LABEL[e.material])} · ${escapeHtml(CUT_ROLE_LABEL[e.role] || e.role)} · ${escapeHtml(e.color)}, деталь ${e.lengthMm} мм</div>`;
  if(!whLastResults || whLastResults.length === 0){
    return header + `<div class="wh-no-results">Подходящих остатков не найдено — нужно резать новый хлыст (${WH_STOCK_LENGTHS.join(' или ')} мм).</div>`;
  }
  return header + whLastResults.map(({ remnant, use }, i) => `
      <div class="wh-result-card${i === 0 ? ' wh-best' : ''}">
        <div class="wh-result-title">Остаток №${remnant.id}</div>
        <div class="wh-result-grid">
          <div class="wf"><span class="wf-label">Длина остатка</span><span class="wf-value">${escapeHtml(remnant.lengthMm)} мм × ${escapeHtml(remnant.qty)} шт</span></div>
          <div class="wf"><span class="wf-label">Деталей с одного</span><span class="wf-value">${use.piecesPerUnit} шт</span></div>
          <div class="wf"><span class="wf-label">Всего деталей</span><span class="wf-value">${use.totalPieces} шт</span></div>
          <div class="wf"><span class="wf-label">Остаётся</span><span class="wf-value">${use.leftoverMm} мм</span></div>
        </div>
      </div>`).join('');
}

// --- «Взять деталь из проекта»: те же группы, что на экране «Раскрой» ---
interface PickPiece { label: string; colorName: string; role: string; mat: Mat; lengthMm: number; count: number; }
let whPickPieceCache: PickPiece[] = [];
export function openWhPickProject(): void {
  if(!S.projects.length){ showToast('Нет ни одного проекта'); return; }
  $('whPickProjectList').innerHTML = S.projects.map(p => `
      <button class="color-opt" onclick="whPickProjectSelected(${p.id})">
        <span class="avatar" style="width:34px;height:34px;font-size:var(--fs-sm)">${escapeHtml(String(p.number != null ? p.number : p.id))}</span>
        <span>${escapeHtml(p.name)}</span>
      </button>`).join('');
  $('whPickProjectBackdrop').classList.add('open');
}
export function closeWhPickProject(): void { $('whPickProjectBackdrop').classList.remove('open'); }
export function whPickProjectSelected(projectId: number): void {
  closeWhPickProject();
  const project = S.projects.find(p => p.id === projectId);
  if(!project) return;
  const pMat: Mat = project.type === 'alu' ? 'alu' : 'pvc';
  const pieces: PickPiece[] = [];
  extractCuttingGroups(project).forEach(g => g.pieces.forEach(p => pieces.push({
    label: `${g.roleLabel} · ${g.colorName}`, colorName: g.colorName, role: g.role, mat: pMat, lengthMm: p.lengthMm, count: p.count
  })));
  if(!pieces.length){ showToast('В проекте нет деталей'); return; }
  $('whPickPieceList').innerHTML = pieces.map((p, i) => `
      <button class="wh-piece-opt" onclick="whPickPieceSelected(${i})">
        <span class="wp-main">${escapeHtml(p.label)} — ${p.lengthMm} мм</span>
        <span class="wp-sub">${p.count} шт в проекте</span>
      </button>`).join('');
  whPickPieceCache = pieces;
  $('whPickPieceBackdrop').classList.add('open');
}
export function closeWhPickPiece(): void { $('whPickPieceBackdrop').classList.remove('open'); }
export function whPickPieceSelected(i: number): void {
  const p = whPickPieceCache[i];
  closeWhPickPiece();
  if(!p) return;
  whMat = p.mat;
  fillWhSelects();
  whSetSelect('whsRole', p.role);
  whSetSelect('whsColor', p.colorName);
  $input('whsLength').value = String(p.lengthMm);
  renderWarehouseScreen();
  showToast('Профиль, цвет и длина подставлены');
}
