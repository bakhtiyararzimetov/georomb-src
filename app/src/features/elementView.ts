// Экран элемента: схема, размерные линии, панель инструментов, перетаскивание, ввод размеров, отмена/возврат.
import { DEFAULT_H, DEFAULT_W, S } from '../state.ts';
import type { Axis, Rect, TreeNode, WinElement } from '../types.ts';
import { $, $input, isOpen, parseSize, showToast } from '../ui/dom.ts';
import { elementColorHex } from '../data/colors.ts';
import { OPENINGS, SLIDING_TEMPLATES, profileFor, sashBand } from '../data/profiles.ts';
import { computeLayout, insetRect, layoutForDrawing, parseMm } from '../model/layout.ts';
import {
  applySlidingTemplate, ensureRoot, findNode, findParent, findSashOwner, firstLeaf, isElementEmpty, newLeaf, splitNode
} from '../model/tree.ts';
import { INVALID_ELEMENT_MSG, beginChange, finishChange, resetHistory, restoreSnapshot, snapshotElement } from '../model/history.ts';
import { type DimSeg, decodeNodeRefs, encodeNodeRefs, globalChain, setElementSize, setNodeSizeSynced } from '../model/dims.ts';
import { buildSillSvg, buildSvg } from '../render/svg.ts';
import { currentElement, getCurrentProject, saveProjects } from '../storage.ts';
import { renderCanvas } from './projects.ts';
import { TOOLS } from './tools.ts';

export function openElementView(elemId: number): void {
  const project = getCurrentProject();
  if(!project) return;
  S.currentElementIndex = project.elements.findIndex(e => e.id === elemId);
  if(S.currentElementIndex === -1) S.currentElementIndex = 0;
  resetHistory(project.elements[S.currentElementIndex]);
  S.selectedNid = null;
  renderElementView();
  $('elementViewScreen').classList.add('open');
}
export function closeElementView(): void {
  $('elementViewScreen').classList.remove('open');
  renderCanvas();
}
export function stepElement(dir: number): void {
  const project = getCurrentProject();
  if(!project) return;
  const total = project.elements.length;
  S.currentElementIndex = (S.currentElementIndex + dir + total) % total;
  resetHistory(project.elements[S.currentElementIndex]);
  S.selectedNid = null;
  renderElementView();
}

// ===== Размерные линии =====
// Тип (frameDim — рама, mullionDim — импост) пишется в data-dim-kind, по нему CSS выбирает шрифт и толщину.
const DIM_KIND = { FRAME:'frameDim', MULLION:'mullionDim' } as const;
type DimKind = typeof DIM_KIND[keyof typeof DIM_KIND];
const DIM_K: Record<DimKind, number> = { frameDim:1, mullionDim:0 };
// g — «обратная сторона»: размеры оси с противоположной стороны окна (хранится в e.dimG)
function dimSideG(axis: Axis): boolean {
  const e = currentElement();
  return !!(e && e.dimG && e.dimG[axis]);
}
function dimBtnHtml(kind: DimKind, axis: Axis, flex: number, value: number | string, onclick: string): string {
  const frame = kind === DIM_KIND.FRAME;
  const k = DIM_K[kind];
  const g = dimSideG(axis);
  return `<button class="dim-btn${frame ? ' dim-only' : ''}" data-dim-kind="${kind}" data-axis="${axis}" data-dim-k="${k}" data-dim-g="${g ? 1 : 0}" style="flex:${flex};--dim-k:${k}" onclick="${onclick}"><span>${value}</span></button>`;
}
// выносные линии на границах сегментов (проценты от суммы квот)
function extLines(segs: DimSeg[], cls: string, prop: string): string {
  const sum = segs.reduce((a, s) => a + s.size, 0) || 1;
  let c = 0, html = `<i class="dm-ext ${cls}" style="${prop}:0%"></i>`;
  segs.forEach(s => { c += s.size; html += `<i class="dm-ext ${cls}" style="${prop}:${(c / sum * 100).toFixed(3)}%"></i>`; });
  return html;
}
// стороны размеров по флагам g (атрибуты на .elem-view-body читает CSS)
function applyDimSides(e: WinElement): void {
  const body = document.querySelector<HTMLElement>('.elem-view-body');
  if(!body) return;
  const gw = !!(e && e.dimG && e.dimG.width), gh = !!(e && e.dimG && e.dimG.height);
  body.dataset.dimGWidth  = gw ? '1' : '0';
  body.dataset.dimGHeight = gh ? '1' : '0';
  $('elemWidthTotal').dataset.dimG = gw ? '1' : '0';
  $('elemHeightTotal').dataset.dimG = gh ? '1' : '0';
}
function totalSpan(id: string): HTMLElement { return $(id).querySelector('span') as HTMLElement; }

function renderDimBars(e: WinElement, W: number, H: number): void {
  const wRow = $('elemWidthDims'), hCol = $('elemHeightDims');
  const wTotal = $('elemWidthTotal'), hTotal = $('elemHeightTotal');
  // области переплётов створок (для линейки) — та же раскладка, что у чертежа
  const lay = computeLayout(e, profileFor(getCurrentProject()));
  const innerRects: Record<number, Rect> = {};
  lay.leaves.forEach(l => {
    if(l.node.opening && l.node.inner) innerRects[l.node.nid] = insetRect(l.rect, sashBand(lay.profile, l.node.opening));
  });
  const ctx = { innerRect: (nid: number) => innerRects[nid] || null };

  // одна общая цепочка на ось (как в старом проекте): ширина — снизу, высота — слева
  const wSegs = globalChain(e.root, 'x', ctx, W);
  if(wSegs.length){
    wRow.innerHTML = wSegs.map(s =>
      dimBtnHtml(DIM_KIND.MULLION, 'width', s.size, Math.round(s.size), `editNodeDim('${encodeNodeRefs(s.refs)}', 'width', ${s.off || 0})`)
    ).join('') + extLines(wSegs, 'dm-ext-x', 'left');
    wTotal.style.display = 'flex';
    totalSpan('elemWidthTotal').textContent = String(Math.round(W));
    totalSpan('elemWidthTotal').onclick = () => editDimension('width');
  }else{
    wRow.innerHTML = dimBtnHtml(DIM_KIND.FRAME, 'width', 1, W, "editDimension('width')");
    wTotal.style.display = 'none';
  }
  const hSegs = globalChain(e.root, 'y', ctx, H);
  if(hSegs.length){
    hCol.innerHTML = hSegs.map(s =>
      dimBtnHtml(DIM_KIND.MULLION, 'height', s.size, Math.round(s.size), `editNodeDim('${encodeNodeRefs(s.refs)}', 'height', ${s.off || 0})`)
    ).join('') + extLines(hSegs, 'dm-ext-y', 'top');
  }else{
    hCol.innerHTML = dimBtnHtml(DIM_KIND.FRAME, 'height', 1, H, "editDimension('height')");
  }
  // без деления колонка сегментов скрыта: общий размер и так слева
  hCol.style.display = hSegs.length ? '' : 'none';
  hTotal.style.display = 'flex';
  totalSpan('elemHeightTotal').textContent = String(Math.round(H));
  totalSpan('elemHeightTotal').onclick = () => editDimension('height');
}
// как в старом проекте: размеры только слева и снизу — построчные/правые линейки пустые
function clearExtraRulers(): void {
  $('elemRowDims').innerHTML = '';
  $('elemColDims').innerHTML = '';
  $('elemHeightDimsRight').innerHTML = '';
}
// нижняя линейка ширины — строго по границам рамки (левая граница и ширина берутся со схемы)
function syncWidthRuler(): void {
  const shape = $('elemShape');
  const bottomRow = document.querySelector<HTMLElement>('.elem-bottom-row');
  const wrap = document.querySelector<HTMLElement>('.elem-width-wrap');
  const rowDims = $('elemRowDims');
  if(!shape || !bottomRow || !wrap) return;
  const sRect = shape.getBoundingClientRect();
  const bRect = bottomRow.getBoundingClientRect();
  if(sRect.width === 0) return;
  if(!bottomRow.style.minHeight) bottomRow.style.minHeight = bRect.height + 'px';
  wrap.style.position = 'absolute';
  wrap.style.left = (sRect.left - bRect.left) + 'px';
  wrap.style.width = sRect.width + 'px';
  $('elemWidthDims').style.paddingLeft = '0px';
  $('elemWidthTotal').style.marginLeft = '0px';
  if(rowDims && rowDims.parentElement){
    const parent = rowDims.parentElement;
    const rRect = parent.getBoundingClientRect();
    const padLeft = parseFloat(getComputedStyle(parent).paddingLeft) || 0;
    rowDims.style.marginLeft = Math.max(0, sRect.left - rRect.left - padLeft) + 'px';
    rowDims.style.width = sRect.width + 'px';
  }
}

// Подоконник: размеры вручную, дерева делений нет, панель инструментов пустая
function renderSillView(e: WinElement): void {
  const project = getCurrentProject();
  $('elementViewTitle').textContent = String(S.currentElementIndex + 1);
  const W = parseMm(e.width)  || DEFAULT_W;
  const H = parseMm(e.height) || DEFAULT_H;
  const shape = $('elemShape');
  shape.style.aspectRatio = W + '/' + H;
  shape.innerHTML = buildSillSvg(W, H, elementColorHex(e, project));
  $('elemWidthDims').innerHTML = dimBtnHtml(DIM_KIND.FRAME, 'width', 1, Math.round(W), "editDimension('width')");
  $('elemWidthTotal').style.display = 'none';
  $('elemHeightDims').innerHTML = dimBtnHtml(DIM_KIND.FRAME, 'height', 1, Math.round(H), "editDimension('height')");
  $('elemHeightTotal').style.display = 'flex';
  totalSpan('elemHeightTotal').textContent = String(Math.round(H));
  totalSpan('elemHeightTotal').onclick = () => editDimension('height');
  clearExtraRulers();
  $('elemToolbar').innerHTML = '';
  updateHistoryButtons(e);
  syncWidthRuler();
}

export function renderElementView(): void {
  const project = getCurrentProject();
  if(!project || project.elements.length === 0) return;
  const e = project.elements[S.currentElementIndex];
  applyDimSides(e);            // до измерения схемы: от сторон размеров зависит её ширина
  $('elemStep').style.display = project.elements.length > 1 ? '' : 'none';
  $('elemStepLabel').textContent = (S.currentElementIndex + 1) + ' из ' + project.elements.length;
  if(e.type === 'sill'){ renderSillView(e); return; }
  ensureRoot(e);
  $('elementViewTitle').textContent = String(S.currentElementIndex + 1);

  const shape = $('elemShape');
  shape.style.aspectRatio = (parseMm(e.width) || DEFAULT_W) + '/' + (parseMm(e.height) || DEFAULT_H);
  const out = layoutForDrawing(e, project);
  out.color = elementColorHex(e, project); out.glass = e.glass;
  const { W, H } = out;
  shape.innerHTML = buildSvg(W, H, out);
  // выступ подоконника за раму в px — от него отсчитываются выносные линии
  const body = document.querySelector<HTMLElement>('.elem-view-body')!;
  const k = shape.getBoundingClientRect().width / (W || 1), swv = Math.max(W, H) / 330;
  body.style.setProperty('--sill-x', (out.hasSill ? out.frameT * 0.8 * k : 0).toFixed(1) + 'px');
  body.style.setProperty('--sill-y', (out.hasSill ? (out.frameT * 0.9 + swv * 0.6) * k : 0).toFixed(1) + 'px');

  renderDimBars(e, W, H);
  clearExtraRulers();
  renderToolbar(e);
  updateHistoryButtons(e);
  syncWidthRuler();
}

// ===== Отмена / возврат / очистка =====
function updateHistoryButtons(e: WinElement): void {
  const set = (id: string, disabled: boolean) => { const b = document.getElementById(id) as HTMLButtonElement | null; if(b) b.disabled = disabled; };
  set('elemUndoBtn',  !(e.history && e.history.length));
  set('elemRedoBtn',  !(e.redo && e.redo.length));
  set('elemClearBtn', isElementEmpty(e));
}
export function undoElement(): void {
  const e = currentElement();
  if(!e || !e.history || !e.history.length) return;
  if(!Array.isArray(e.redo)) e.redo = [];
  e.redo.push(snapshotElement(e));
  restoreSnapshot(e, e.history.pop()!);
  saveProjects();
  S.selectedNid = null;
  renderElementView();
}
export function redoElement(): void {
  const e = currentElement();
  if(!e || !e.redo || !e.redo.length) return;
  e.history.push(snapshotElement(e));
  restoreSnapshot(e, e.redo.pop()!);
  saveProjects();
  S.selectedNid = null;
  renderElementView();
}
// «Очистить»: пустая рама с одним стеклом; размеры остаются
export function clearElementScheme(): void {
  const e = currentElement();
  if(!e || isElementEmpty(e)) return;
  const tok = beginChange(e);
  e.root = null;
  ensureRoot(e);
  e.slidingTemplate = null;
  S.selectedNid = null;
  finishChange(e, tok, true);        // очистка допустима всегда
  renderElementView();
}

// ===== Панель инструментов =====
function slidingTitle(cells: { type: string; hinge?: string }[]): string {
  return cells.length + ' створки: ' + cells.map(c => c.type === 'Sliding'
    ? 'подвижная (ручка ' + (c.hinge === 'left' ? 'слева' : 'справа') + ')' : 'глухая').join(' + ');
}
// иконка шаблона 24×24: ячейки, у подвижных — стрелка движения
function slidingIcon(cells: { type: string; hinge?: string }[]): string {
  const X0 = 3.5, Y0 = 4.5, W = 17, H = 15, n = cells.length, cw = W / n;
  let s = `<rect x="${X0}" y="${Y0}" width="${W}" height="${H}" rx="2" stroke="currentColor" stroke-width="1.5"/>`;
  for(let i = 1; i < n; i++){
    const x = X0 + i * cw;
    s += `<path d="M${x} ${Y0}v${H}" stroke="currentColor" stroke-width="1.3"/>`;
  }
  cells.forEach((c, i) => {
    const x = X0 + i * cw;
    if(c.type !== 'Sliding') return;
    const dir = (c.hinge === 'left') ? 1 : -1;
    const x0 = (c.hinge === 'left') ? x + 1 : x + cw - 1;
    const x1 = x0 + dir * cw * 0.5, y = Y0 + H * 0.5, t = Math.min(1.7, cw * 0.28);
    s += `<path d="M${x0} ${y} L${x1} ${y}" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`
       + `<path d="M${x1} ${y - t} L${x1} ${y + t} L${x1 + dir * t} ${y} Z" fill="currentColor" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round"/>`;
  });
  return s;
}
function toolBtn(tag: string, title: string, active: boolean, icon: string): string {
  return `<button class="tool-btn${active ? ' active' : ''}" title="${title}"
            onpointerdown="startToolDrag(event, '${tag}')" aria-label="${title}">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">${icon}</svg>
          </button>`;
}
function renderToolbar(e: WinElement): void {
  const bar = $('elemToolbar');
  if(e.type === 'sill'){ bar.innerHTML = ''; return; }
  if(e.type === 'sliding'){
    // раздвижные: 10 шаблонов (применяются ко всему элементу)
    bar.innerHTML = Object.keys(SLIDING_TEMPLATES).map(tag => {
      const cells = SLIDING_TEMPLATES[tag].cells;
      return toolBtn(tag, slidingTitle(cells), e.slidingTemplate === tag, slidingIcon(cells));
    }).join('');
    return;
  }
  const node = S.selectedNid ? findNode(e.root, S.selectedNid) : null;
  bar.innerHTML = TOOLS.map(t => {
    let active = false;
    if(node && node.kind === 'leaf'){
      const op = OPENINGS[t.tag];
      if(op && node.opening && node.opening.type === op.type && node.opening.hinge === op.hinge) active = true;
      if(t.tag === 'verticalPanel'   && node.fill === 'panelV') active = true;
      if(t.tag === 'horizontalPanel' && node.fill === 'panelH') active = true;
    }
    return toolBtn(t.tag, t.title, active, t.icon);
  }).join('');
}
export function selectNode(nid: number): void {
  S.selectedNid = (S.selectedNid === nid) ? null : nid;
  renderElementView();
}
function applyTool(tag: string): void {
  const e = currentElement();
  if(!e) return;
  const root = ensureRoot(e);
  const node = (S.selectedNid ? findNode(root, S.selectedNid) : null) || firstLeaf(root);
  applyToolToNode(e, node, tag);
}
// инструмент перетащили на узел схемы
function applyToolAt(tag: string, nid: number): void {
  const e = currentElement();
  if(!e) return;
  const root = ensureRoot(e);
  applyToolToNode(e, findNode(root, nid) || firstLeaf(root), tag);
}
// снимок ДО изменения; если элемент стал недопустимым — откат и тост
function applyToolToNode(e: WinElement, node: TreeNode, tag: string): void {
  const tok = beginChange(e);
  const selBefore = S.selectedNid;
  applyToolToNodeRaw(e, node, tag);
  if(!finishChange(e, tok)) S.selectedNid = selBefore;
  renderElementView();
}
function applyToolToNodeRaw(e: WinElement, node: TreeNode, tag: string): void {
  if(SLIDING_TEMPLATES[tag]){
    if(e.type === 'sliding'){ applySlidingTemplate(e, tag); S.selectedNid = null; }
    return;
  }
  if(tag === 'MV1' || tag === 'MV2' || tag === 'MH'){
    const dir = (tag === 'MH') ? 'h' : 'v';
    const count = (tag === 'MV2') ? 3 : 2;
    // деление створки: opening остаётся на створке, переплёт — в node.inner; есть переплёт — делим его первую ячейку
    let target = node;
    if(target.kind === 'leaf' && target.inner) target = firstLeaf(target.inner);
    let first: TreeNode;
    if(target.kind === 'leaf' && target.opening){
      const inner = newLeaf();
      first = splitNode(inner, dir, count);
      target.inner = inner;
    }else{
      // деление локальное; если родитель уже делится В ТУ ЖЕ сторону — новые импосты встают в его цепочку
      const parent = findParent(e.root, target.nid);
      if(parent && parent.kind === 'branch' && parent.dir === dir && !parent.dividers && Array.isArray(parent.sizes)
         && parent.sizes.length === parent.children!.length){
        const idx = parent.children!.indexOf(target);
        const L = parent.sizes[idx];
        const kids: TreeNode[] = [], parts: number[] = [];
        for(let i = 0; i < count; i++){
          kids.push(newLeaf());
          parts.push(Math.round(L * (i + 1) / count) - Math.round(L * i / count));
        }
        parent.children!.splice(idx, 1, ...kids);
        parent.sizes.splice(idx, 1, ...parts);
        first = kids[0];
      }else{
        first = splitNode(target, dir, count);
      }
    }
    S.selectedNid = first.nid;
    return;
  }
  if(node.kind !== 'leaf') node = firstLeaf(node);
  if(OPENINGS[tag]){
    const owner = findSashOwner(e.root, node.nid);   // открывание относится к створке целиком
    if(owner) node = owner;
  }else if(node.inner){
    node = firstLeaf(node.inner);                    // панель ложится на внутреннюю ячейку
  }
  // инструмент только ставит/заменяет; убрать — отменой или «Очистить»
  if(tag === 'verticalPanel'){
    node.fill = 'panelV';
  }else if(tag === 'horizontalPanel'){
    node.fill = 'panelH';
  }else if(OPENINGS[tag]){
    // открывание создаёт НОВУЮ створку: прежняя вместе с переплётом удаляется, в новой одно стекло
    const next = OPENINGS[tag];
    node.opening = { type:next.type, hinge:next.hinge };
    delete node.inner;
    node.fill = 'glass';
  }
  S.selectedNid = node.nid;
}

// --- перетаскивание инструмента с панели на створку ---
export function startToolDrag(ev: PointerEvent, tag: string): void {
  if(ev.pointerType === 'mouse' && ev.button !== 0) return;
  ev.preventDefault();
  const ghost = document.createElement('div');
  ghost.className = 'tool-drag-ghost';
  const svg = (ev.currentTarget as HTMLElement).querySelector('svg');
  ghost.innerHTML = svg ? svg.outerHTML : '';
  document.body.appendChild(ghost);
  const moveGhost = (x: number, y: number) => { ghost.style.left = x + 'px'; ghost.style.top = y + 'px'; };
  moveGhost(ev.clientX, ev.clientY);
  const drag = { x0:ev.clientX, y0:ev.clientY, moved:false, overNid:null as number | null };
  const clearHighlight = () => {
    document.querySelectorAll('.leaf-drop-target').forEach(el => el.classList.remove('leaf-drop-target'));
  };
  const onMove = (e2: PointerEvent) => {
    moveGhost(e2.clientX, e2.clientY);
    if(Math.abs(e2.clientX - drag.x0) > 6 || Math.abs(e2.clientY - drag.y0) > 6) drag.moved = true;
    const el = document.elementFromPoint(e2.clientX, e2.clientY);
    const target = el && el.closest ? el.closest('[data-nid]') : null;
    const nid = target ? parseInt(target.getAttribute('data-nid') || '', 10) : null;
    if(nid !== drag.overNid){
      clearHighlight();
      if(target) target.classList.add('leaf-drop-target');
      drag.overNid = nid;
    }
  };
  const finish = (apply: boolean) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    ghost.remove();
    clearHighlight();
    if(apply){
      if(drag.moved && drag.overNid != null) applyToolAt(tag, drag.overNid);
      else applyTool(tag);   // просто тап — по выбранной створке
    }
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
}

// ===== Ввод размера: мини-клавиатура только с цифрами (поле readonly) =====
let dimFresh = false;
const DIM_MAX_DIGITS = 5;
function focusDimInput(): void {
  const inp = $input('dimInput');
  dimFresh = true;
  inp.focus();
  inp.select();
}
export function dimKey(k: string): void {
  const inp = $input('dimInput');
  let v = dimFresh ? '' : inp.value;
  if(k === 'clear' || k === 'back'){
    v = (k === 'clear' || dimFresh) ? '' : v.slice(0, -1);
  }else{
    if(dimFresh && k === '0') return;        // число не может начинаться с нуля
    if(v.length >= DIM_MAX_DIGITS) return;
    v += k;
  }
  dimFresh = false;
  inp.value = v;
}
// nodeRefs — "nid:index[,nid:index…]": один импост через несколько строк/колонок правится сразу во всех узлах
export function editNodeDim(nodeRefs: string, axis: Axis, off: number): void {
  const e = currentElement();
  if(!e) return;
  const list = decodeNodeRefs(nodeRefs)
    .map(r => ({ nid:r.nid, index:r.index, node:findNode(e.root, r.nid) }))
    .filter(r => r.node && Array.isArray(r.node.sizes) && r.node.sizes[r.index] !== undefined);
  if(!list.length) return;
  off = off || 0;
  S.dimEditing = { nodes:list.map(r => ({ nid:r.nid, index:r.index })), axis, off };
  $('dimSheetTitle').textContent = (axis === 'width' ? 'Ширина створки, мм' : 'Высота створки, мм');
  $input('dimInput').value = String(Math.round(list[0].node!.sizes![list[0].index] + off));
  $('dimBackdrop').classList.add('open');
  focusDimInput();
}
export function editDimension(which: Axis): void {
  const e = currentElement();
  if(!e) return;
  S.dimEditing = which;
  $('dimSheetTitle').textContent = (which === 'width' ? 'Ширина, мм' : 'Высота, мм');
  $input('dimInput').value = String(which === 'width' ? e.width : e.height);
  $('dimBackdrop').classList.add('open');
  focusDimInput();
}
export function closeDimSheet(): void { $('dimBackdrop').classList.remove('open'); }
// число применяется; если элемент стал недопустимым (в т.ч. 0 у сегмента) — тост и откат; окно закрывается всегда
export function saveDimension(): void {
  const e = currentElement();
  const editing = S.dimEditing;
  if(!e || !editing){ closeDimSheet(); return; }
  const val = $input('dimInput').value.trim();
  if(val){
    const num = (Number(val.replace(',', '.')) === 0) ? 0 : parseSize(val);   // parseSize() ноль не принимает
    if(isNaN(num)){ showToast(INVALID_ELEMENT_MSG); closeDimSheet(); return; }
    const tok = beginChange(e);
    const ok = (typeof editing === 'object')
      ? setNodeSizeSynced(e, editing.nodes, num - (editing.off || 0))
      : setElementSize(e, editing, num);
    if(ok) finishChange(e, tok);
    else restoreSnapshot(e, tok.snap);
  }
  closeDimSheet();
  renderElementView();
}

// ===== Запуск: клавиатура и увеличенная зона нажатия размеров =====
export function initElementView(): void {
  // клавиатура компьютера: цифры, Backspace, Enter (readonly-поле получает keydown)
  $input('dimInput').addEventListener('keydown', ev => {
    if(/^[0-9]$/.test(ev.key)){ dimKey(ev.key); ev.preventDefault(); }
    else if(ev.key === 'Backspace'){ dimKey('back'); ev.preventDefault(); }
    else if(ev.key === 'Enter'){ saveDimension(); ev.preventDefault(); }
  });
  // Кнопки размеров узкие (линии чертежа); тап мимо них ищет ближайшую в пределах 14 px и нажимает её.
  const TOL = 14;
  const distToRect = (x: number, y: number, r: DOMRect) =>
    Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
  document.addEventListener('click', ev => {
    const t = ev.target as Element | null;
    if(!t || !t.closest || !t.closest('.elem-view-body')) return;
    if(t.closest('.dim-btn') || t.closest('.dim-total span')) return;   // попали точно — сработает свой onclick
    const body = document.querySelector('.elem-view-body');
    if(!body) return;
    let best: HTMLElement | null = null, bestDist = Infinity;
    body.querySelectorAll<HTMLElement>('.dim-btn, .dim-total span').forEach(el => {
      if(el.offsetParent === null) return;
      const r = el.getBoundingClientRect();
      if(!r.width && !r.height) return;
      const d = distToRect(ev.clientX, ev.clientY, r);
      if(d < bestDist){ bestDist = d; best = el; }
    });
    if(best && bestDist <= TOL) (best as HTMLElement).click();
  });
}
export const isElementViewOpen = (): boolean => isOpen('elementViewScreen');
