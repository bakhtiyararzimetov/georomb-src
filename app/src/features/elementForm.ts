// Форма нового элемента, шторка «Редактировать элемент», меню «Ещё» на экране элемента.
import { DEFAULT_H, DEFAULT_QTY, DEFAULT_W, S } from '../state.ts';
import type { ElementType, WinElement } from '../types.ts';
import { $, $input, $select, isOpen, parseSize, showToast } from '../ui/dom.ts';
import { fillColorSelect, fillGlassSelect, openConfirm, openSummaryRows } from '../ui/dialogs.ts';
import { findColor } from '../data/colors.ts';
import { GLASS_NEW_DEFAULT, elementGlassName, findGlass } from '../data/glass.ts';
import { ensureRoot, renumberTree } from '../model/tree.ts';
import { parseMm } from '../model/layout.ts';
import { INVALID_ELEMENT_MSG, beginChange, finishChange, isElementValid, restoreSnapshot } from '../model/history.ts';
import { setElementSize } from '../model/dims.ts';
import { calcElement, fmtMoney, fmtNum, fmtSummaryMoney } from '../model/pricing.ts';
import { getCurrentProject, saveProjects } from '../storage.ts';
import { renderCanvas } from './projects.ts';
import { closeElementView, renderElementView } from './elementView.ts';

const checked = (name: string): string | null => {
  const r = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return r ? r.value : null;
};
const setRadio = (name: string, value: string): void => {
  const r = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if(r) r.checked = true;
};
const raw = (id: string): string => $input(id).value.trim();

// поля напуска/длины подоконника видны только при «Подоконник: Да»
export function toggleSillLenRow(): void {
  const yes = checked('elemSill') === 'yes';
  ['elemSillWidthRow', 'elemSillOverhangRow', 'elemSillLenRow'].forEach(id => { $(id).style.display = yes ? '' : 'none'; });
  updateSillLenPlaceholder();
}
// подсказка в поле длины: ширина + напуск с двух сторон (только placeholder)
export function updateSillLenPlaceholder(): void {
  const w = parseSize(raw('elemWidth')) || DEFAULT_W;
  const ov = parseSize(raw('elemSillOverhang'));
  $input('elemSillLen').placeholder = String(Math.round(w + 2 * (isNaN(ov) ? 20 : ov)));
}
export function openElementForm(): void {
  S.editingElementId = null;   // форма открыта кнопкой «добавить» — режим нового элемента
  (['elemWidth', 'elemHeight', 'elemQty'] as const).forEach(id => { $input(id).value = ''; });
  $input('elemWidth').placeholder = String(DEFAULT_W);
  $input('elemHeight').placeholder = String(DEFAULT_H);
  $input('elemQty').placeholder = String(DEFAULT_QTY);
  setRadio('elemType', 'casement');
  setRadio('elemSill', 'no');
  setRadio('elemNet', 'no');
  $select('elemSillWidth').value = '20';
  $input('elemSillOverhang').value = '';
  $input('elemSillLen').value = '';
  toggleSillLenRow();
  const project = getCurrentProject();
  fillGlassSelect('elemGlass', 'elemGlassSwatch', (project && project.defaultGlass) || GLASS_NEW_DEFAULT);   // стекло последнего элемента проекта
  fillColorSelect('elemColor', 'elemColorSwatch', project, (project && project.defaultColor) || null);       // цвет из каталога / последнего элемента
  $('elementScreen').classList.add('open');
}
export function closeElementForm(): void {
  $('elementScreen').classList.remove('open');
  S.editingElementId = null;
}

// поле net пишется только когда сетка есть — у старых элементов и без сетки формат прежний
function setNet(e: WinElement, net: boolean): void { if(net) e.net = true; else delete e.net; }

interface SillInput { needSill: boolean; sillWidth: number; sillLen: number; }
// длина подоконника: пусто — ширина + 2·напуск (пусто напуск — 20 мм); хранится в метрах
function readSill(prefix: 'elem' | 'editElem', radioName: string, width: number): SillInput | null {
  const needSill = checked(radioName) === 'yes';
  const sillWidth = needSill ? (parseInt($select(prefix + 'SillWidth').value, 10) || 20) : 0;
  const ovRaw = raw(prefix + 'SillOverhang'), lenRaw = raw(prefix + 'SillLen');
  const sillOverhang = needSill ? (ovRaw === '' ? 20 : parseSize(ovRaw)) : 0;
  const sillLenMm = needSill ? (lenRaw === '' ? (width + 2 * sillOverhang) : parseSize(lenRaw)) : 0;
  if(needSill && (isNaN(sillOverhang) || isNaN(sillLenMm))){ showToast('Недопустимая длина подоконника'); return null; }
  return { needSill, sillWidth, sillLen: sillLenMm / 1000 };
}

export function addElementItem(): void {
  const project = getCurrentProject();
  if(!project) return;
  const type = checked('elemType') as ElementType;
  // пустое поле — значение по умолчанию; непустое нечисловое — тост и без сохранения
  const pick = (id: string, def: number) => raw(id) === '' ? def : parseSize(raw(id));
  const width = pick('elemWidth', DEFAULT_W), height = pick('elemHeight', DEFAULT_H), qty = pick('elemQty', DEFAULT_QTY);
  if(isNaN(width) || isNaN(height) || isNaN(qty)){ showToast('Недопустимый размер'); return; }
  const colorCode = $select('elemColor').value || null;
  const glassCode = findGlass($select('elemGlass').value).code;
  const sill = readSill('elem', 'elemSill', width);
  if(!sill) return;
  const net = checked('elemNet') === 'yes';
  if(S.editingElementId !== null){
    const e = project.elements.find(el => el.id === S.editingElementId);
    if(e){
      if(!applyFormSize(e, type, width, height)) return;
      e.qty = qty; e.color = colorCode; e.glass = glassCode;
      setSill(e, sill);
      setNet(e, net);
    }
    S.editingElementId = null;
    closeElementForm();
    saveProjects();
    renderCanvas();
    if(isOpen('elementViewScreen')) renderElementView();
    return;
  }
  // запоминаем цвет рамы и стекло: в форме следующего элемента этого проекта они выбраны сразу
  if(colorCode) project.defaultColor = colorCode;
  project.defaultGlass = glassCode;
  const el: WinElement = { id: S.nextElemId++, type, width, height, qty, color: colorCode, glass: glassCode, history: [], redo: [] };
  setSill(el, sill);
  setNet(el, net);
  project.elements.push(el);
  closeElementForm();
  saveProjects();
  renderCanvas();
  // добавили из редактора окна — сразу показываем новый элемент
  if(isOpen('elementViewScreen')){
    S.currentElementIndex = project.elements.length - 1;
    S.selectedNid = null;
    renderElementView();
  }
}

// ===== Меню «Ещё» (⋮) на экране элемента =====
export function toggleElementMenu(ev: Event): void {
  ev.stopPropagation();
  $('elementMenuBackdrop').classList.toggle('open');
}
export function closeElementMenu(): void { $('elementMenuBackdrop').classList.remove('open'); }

function current(): WinElement | null {
  const project = getCurrentProject();
  return project ? project.elements[S.currentElementIndex] || null : null;
}

export function startEditElement(): void {
  closeElementMenu();
  const project = getCurrentProject();
  const e = current();
  if(!project || !e) return;
  S.editingElementId = e.id;
  $input('editElemNumber').value = String(S.currentElementIndex + 1);
  setRadio('editElemType', e.type);
  $input('editElemWidth').value = String(e.width);
  $input('editElemHeight').value = String(e.height);
  $input('editElemQty').value = String(e.qty);
  setRadio('editElemSill', e.sill ? 'yes' : 'no');
  setRadio('editElemNet', e.net ? 'yes' : 'no');
  $select('editElemSillWidth').value = String(e.sill ? (e.sillWidth || 20) : 20);
  $input('editElemSillOverhang').value = '';
  $input('editElemSillLen').value = e.sill ? String(Math.round((e.sillLen || 0) * 1000)) : '';
  toggleEditSillLenRow();
  fillColorSelect('editElemColor', 'editElemColorSwatch', project, e.color);
  fillGlassSelect('editElemGlass', 'editElemGlassSwatch', e.glass);
  $('editElementBackdrop').classList.add('open');
}
export function toggleEditSillLenRow(): void {
  const yes = checked('editElemSill') === 'yes';
  ['editElemSillWidthRow', 'editElemSillOverhangRow', 'editElemSillLenRow'].forEach(id => { $(id).style.display = yes ? '' : 'none'; });
}
export function updateEditSillLenPlaceholder(): void {
  const w = parseSize(raw('editElemWidth')) || DEFAULT_W;
  const ov = parseSize(raw('editElemSillOverhang'));
  $input('editElemSillLen').placeholder = String(Math.round(w + 2 * (isNaN(ov) ? 20 : ov)));
}
export function closeEditElement(): void {
  $('editElementBackdrop').classList.remove('open');
  S.editingElementId = null;
}
// Размер из формы — тот же шаг истории, что и правка на схеме: недопустимый откатывается с тостом
// (форма остаётся открытой), допустимый попадает в «Отменить» / «Вернуть». false — не принято.
// у отдельного подоконника своего «прикреплённого» подоконника нет (иначе он попадает в смету, PDF и сводку)
function setSill(e: WinElement, sill: SillInput): void {
  const on = sill.needSill && e.type !== 'sill';
  e.sill = on; e.sillLen = on ? sill.sillLen : 0; e.sillWidth = on ? sill.sillWidth : 0;
}
function applyFormSize(e: WinElement, type: ElementType, width: number, height: number): boolean {
  if(e.type !== type){                                // смена типа — дерево и история заново
    const prev = { type: e.type, root: e.root, width: e.width, height: e.height, history: e.history, redo: e.redo };
    e.type = type; e.root = null; e.history = []; e.redo = []; e.width = width; e.height = height;
    if(!isElementValid(e)){ Object.assign(e, prev); showToast(INVALID_ELEMENT_MSG); return false; }
    S.selectedNid = null;
    return true;
  }
  ensureRoot(e);                                       // проверка всё равно создаст дерево — до снимка, иначе он «изменится»
  const tok = beginChange(e);
  // как на схеме (setElementSize): меняется только крайняя ячейка, заданные размеры остальных сохраняются.
  // То же число — не трогаем (после перетаскивания размера там строка «1500»): иначе пустой шаг «Отменить»
  for(const [which, v] of [['width', width], ['height', height]] as const){
    if(parseMm(e[which]) === v) continue;
    if(!setElementSize(e, which, v)){ restoreSnapshot(e, tok.snap); return false; }   // тост уже показан
  }
  return finishChange(e, tok);
}

export function saveEditElement(): void {
  const project = getCurrentProject();
  if(!project || S.editingElementId === null) return;
  const e = project.elements.find(el => el.id === S.editingElementId);
  if(!e){ closeEditElement(); return; }
  const type = (checked('editElemType') as ElementType | null) || e.type;
  const width = parseSize(raw('editElemWidth'));
  const height = parseSize(raw('editElemHeight'));
  const qty = parseSize(raw('editElemQty'));
  if(isNaN(width) || isNaN(height) || isNaN(qty)){ showToast('Недопустимый размер'); return; }
  const sill = readSill('editElem', 'editElemSill', width);
  if(!sill) return;
  const colorSel = $select('editElemColor');
  if(!applyFormSize(e, type, width, height)) return;
  e.qty = qty;
  setSill(e, sill);
  setNet(e, checked('editElemNet') === 'yes');
  if(colorSel && !colorSel.disabled) e.color = colorSel.value;
  e.glass = findGlass($select('editElemGlass').value).code;
  S.editingElementId = null;
  closeEditElement();
  saveProjects();
  renderCanvas();
  if(isOpen('elementViewScreen')) renderElementView();
}
export function confirmDeleteCurrentElement(): void {
  closeElementMenu();
  const project = getCurrentProject();
  if(!project || !current()) return;
  openConfirm('Удалить текущий элемент?', () => {
    project.elements.splice(S.currentElementIndex, 1);
    saveProjects();
    closeElementView();     // назад к проекту (closeElementView сам перерисовывает список)
    renderCanvas();
    showToast('Элемент удалён');
  });
}
// сбросить схему к пустому стеклу; размеры, количество и тип не трогаются
export function clearCurrentElement(): void {
  closeElementMenu();
  const e = current();
  if(!e) return;
  openConfirm('Убрать разметку схемы и вернуть к пустому стеклу?', () => {
    e.root = null;
    S.selectedNid = null;
    S.dimEditing = null;
    renderElementView();
    renderCanvas();
    saveProjects();
    showToast('Схема очищена');
  });
}
// дубликат текущего элемента сразу после оригинала (новый id и nid узлов)
export function copyCurrentElement(): void {
  closeElementMenu();
  const project = getCurrentProject();
  const e = current();
  if(!project || !e) return;
  const copy = JSON.parse(JSON.stringify(e)) as WinElement;
  copy.id = S.nextElemId++;
  copy.history = []; copy.redo = [];
  renumberTree(copy.root);
  project.elements.splice(S.currentElementIndex + 1, 0, copy);
  S.currentElementIndex = S.currentElementIndex + 1;
  S.selectedNid = null;
  renderElementView();
  renderCanvas();
  saveProjects();
  showToast('Элемент скопирован');
}
export function openElementSummary(): void {
  closeElementMenu();
  const project = getCurrentProject();
  const e = current();
  if(!project || !e) return;
  const c = calcElement(e, project);
  const col = findColor(project, e.color);
  const rows: [string, unknown][] = [
    ['Номер элемента', S.currentElementIndex + 1],
    ['Тип элемента', e.type === 'sill' ? 'Подоконник' : e.type === 'sliding' ? 'Раздвижение' : 'Створный'],
    ['Цвет рамы', col ? (col.ral && !String(col.name).includes(col.ral) ? col.name + ' (' + col.ral + ')' : col.name) : '—']
  ];
  const isSill = e.type === 'sill';                    // у отдельного подоконника нет стекла, площади окна и профилей
  if(!isSill) rows.push(['Цвет окна', elementGlassName(e)]);
  rows.push(['Размер', e.width + ' × ' + e.height + ' мм'], ['Количество', fmtNum(c.qty, 0)]);
  if(!isSill) rows.push(
    ['Площадь элемента', fmtNum(c.g.area, 2) + ' м²'],
    ['Площадь стекла', fmtNum(c.g.glassArea, 1) + ' м²'],
    ['Длина профилей', fmtNum(c.g.profileLen, 1) + ' м']
  );
  if(e.type === 'sill' || e.sill) rows.push(['Подоконник', fmtNum((c.g.sillLen || 0) * c.qty, 2) + ' м, полка ' + (c.g.sillWidth || 20) + ' см (' + fmtMoney(c.sillCost * c.qty) + ')']);
  if(c.g.nets.length) rows.push(['Москитная сетка', c.g.nets.length + ' шт: ' + c.g.nets.map(n => n.w + '×' + n.h).join(', ') + ' мм']);
  if(c.g.reinfLen > 0) rows.push(['Армирование', fmtNum(c.g.reinfLen, 1) + ' м']);
  rows.push(['Оценка цены', fmtSummaryMoney(c.total)]);
  openSummaryRows('Резюме элемента', rows);
}
