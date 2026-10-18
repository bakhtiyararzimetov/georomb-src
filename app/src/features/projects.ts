// Главный экран «Мои проекты», форма проекта, экран проекта (сетка элементов), сводка.
import { DEFAULT_H, DEFAULT_W, S } from '../state.ts';
import type { Project, WinElement } from '../types.ts';
import { $, $input, escapeHtml, showToast } from '../ui/dom.ts';
import { openConfirm, openSummaryRows } from '../ui/dialogs.ts';
import { elementColorHex, findColor } from '../data/colors.ts';
import { layoutForDrawing } from '../model/layout.ts';
import { renumberTree } from '../model/tree.ts';
import { calcProject, fmtMoney, fmtNum, fmtSummaryMoney } from '../model/pricing.ts';
import { buildSillSvg, buildSvg } from '../render/svg.ts';
import { getCurrentProject, nextFreeNumber, saveProjects, withoutHistory } from '../storage.ts';

export const DELETE_PROJECT_TEXT = 'Вы уверены, что хотите удалить выбранный проект?';

export function render(filter = ''): void {
  const list = $('list');
  const q = filter.trim().toLowerCase();
  const shown = S.projects.filter(p => p.name.toLowerCase().includes(q));
  if(shown.length === 0){
    list.innerHTML = `<div class="empty">${S.projects.length === 0 ? 'Проектов пока нет.<br>Нажмите «+», чтобы создать первый.' : 'Ничего не найдено'}</div>`;
    return;
  }
  list.innerHTML = shown.map(p => `
      <div class="project-card" onclick="openProject(${p.id})">
        <div class="avatar">${p.number != null ? escapeHtml(String(p.number)) : p.id}</div>
        <div class="project-info">
          <div class="project-name">${escapeHtml(p.name)}</div>
          <div class="project-meta">${p.date}</div>
        </div>
      </div>
    `).join('');
}
export const rerenderList = (): void => render($input('searchInput').value);

export function onSearch(): void {
  const val = $input('searchInput').value;
  $('clearBtn').classList.toggle('show', val.length > 0);
  render(val);
}
export function clearSearch(): void {
  $input('searchInput').value = '';
  $('clearBtn').classList.remove('show');
  render();
}

// Форма проекта: одна для создания и правки (editingProjectId === null — новый проект)
let editingProjectId: number | null = null;
export function openProjectForm(project: Project | null): void {
  editingProjectId = project ? project.id : null;
  const free = nextFreeNumber();
  $('projectFormTitle').textContent = project ? 'Редактировать проект' : 'Новый проект';
  $input('projectNumber').value      = String(project ? project.number : free);
  $input('newProjectName').value     = project ? project.name : 'Проект ' + free;
  $input('projectPhone').value       = project ? (project.phone || '') : '';
  $input('projectAddress').value     = project ? (project.address || '') : '';
  ($('projectDescription') as HTMLTextAreaElement).value = project ? (project.description || '') : '';
  const type = (project && project.type === 'alu') ? 'alu' : 'pvc';
  document.querySelectorAll<HTMLInputElement>('input[name="projType"]').forEach(r => { r.checked = (r.value === type); r.disabled = !!project; });   // тип при правке не меняется
  document.querySelectorAll('#newProjectScreen .radio-opt').forEach(l => l.classList.toggle('disabled', !!project));
  $('newProjectScreen').classList.add('open');
  setTimeout(() => $input('newProjectName').select(), 100);
}
export function openNewProject(): void { openProjectForm(null); }
export function closeNewProject(): void {
  $('newProjectScreen').classList.remove('open');
  editingProjectId = null;
}
export function saveProjectForm(): void {
  // номер: целое > 0, не занятое другим проектом
  const numRaw = $input('projectNumber').value.trim();
  const number = /^\d{1,9}$/.test(numRaw) ? parseInt(numRaw, 10) : NaN;
  if(!(number > 0) || S.projects.some(p => p.id !== editingProjectId && Number(p.number) === number)){
    showToast('Номер проекта недопустимый');
    return;
  }
  const name = $input('newProjectName').value.trim();
  if(!name){ showToast('Название проекта не может быть пустым'); return; }
  const data = {
    number, name,
    phone:       $input('projectPhone').value.trim(),
    address:     $input('projectAddress').value.trim(),
    description: ($('projectDescription') as HTMLTextAreaElement).value.trim()
  };
  if(editingProjectId !== null){
    const project = S.projects.find(p => p.id === editingProjectId);
    closeNewProject();
    if(!project) return;
    Object.assign(project, data);
    if(S.currentProjectId === project.id) $('projectScreenTitle').textContent = project.name;
    saveProjects();
    rerenderList();
    return;
  }
  const type = (document.querySelector('input[name="projType"]:checked') as HTMLInputElement).value as 'pvc' | 'alu';
  const project: Project = Object.assign({ id: S.nextId++, date: 'Сегодня', type, elements: [] as WinElement[] }, data);
  S.projects.unshift(project);
  closeNewProject();
  saveProjects();
  rerenderList();
  openProjectScreen(project);
}

export function openProjectScreen(project: Project): void {
  S.currentProjectId = project.id;
  $('projectScreenTitle').textContent = project.name;
  $('projectScreen').classList.add('open');
  renderCanvas();
}
export function closeProjectScreen(): void {
  $('projectScreen').classList.remove('open');
  S.currentProjectId = null;
}
export function openProject(id: number): void {
  const project = S.projects.find(p => p.id === id);
  if(project) openProjectScreen(project);
}
export function deleteProject(id: number): void {
  S.projects = S.projects.filter(p => p.id !== id);
  saveProjects();
  rerenderList();
}

export function renderCanvas(): void {
  const canvas = $('projectCanvas');
  const project = getCurrentProject();
  if(!project || project.elements.length === 0){
    canvas.innerHTML = `<div class="empty">Элементов пока нет.<br>Нажмите значок «добавить», чтобы создать первый.</div>`;
    return;
  }
  canvas.innerHTML = `<div class="elem-list">` + project.elements.map((e, i) => {
    const c = findColor(project, e.color);
    return `
      <div class="elem-card" onclick="openElementView(${e.id})">
        <div class="elem-thumb">${elementThumbSvg(e, project)}</div>
        <div class="elem-foot">
          <div class="elem-num">${i + 1}</div>
          <div class="elem-meta"><div>${e.width} * ${e.height}</div><div>Количество : ${e.qty}</div>${(e.color && !c) ? '<div style="color:var(--danger);font-size:var(--fs-2xs)">Цвет не найден</div>' : ''}</div>
        </div>
      </div>
    `;
  }).join('') + `</div>`;
}

// миниатюра схемы для карточки: та же отрисовка, что на экране элемента; у градиента стекла свой id, клики убраны
function elementThumbSvg(e: WinElement, project: Project): string {
  if(e.type === 'sill'){
    const W = parseFloat(String(e.width)) || DEFAULT_W, H = parseFloat(String(e.height)) || DEFAULT_H;
    return buildSillSvg(W, H, elementColorHex(e, project)).replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');
  }
  const out = layoutForDrawing(e, project);
  out.color = elementColorHex(e, project); out.glass = e.glass;
  return buildSvg(out.W, out.H, out)
    .replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ')
    .replace(/glassGrad/g, 'glassGradT' + e.id)
    .replace(/ data-nid="\d+"/g, '')
    .replace(/ onclick="selectNode\(\d+\)"/g, '')
    .replace(/ style="cursor:pointer"/g, '');
}

// ===== Меню «Ещё» (⋮) на экране проекта =====
export function toggleProjectMenu(ev: Event): void {
  ev.stopPropagation();
  $('projectMenuBackdrop').classList.toggle('open');
}
export function closeProjectMenu(): void { $('projectMenuBackdrop').classList.remove('open'); }
export function startEditProject(): void {
  closeProjectMenu();
  const project = getCurrentProject();
  if(project) openProjectForm(project);
}

// Копия проекта: новые id, номер, nid узлов; имя + ' (копия)'
export function copyProject(id: number): void {
  const src = S.projects.find(p => p.id === id);
  if(!src) return;
  const copy = JSON.parse(JSON.stringify(src, withoutHistory)) as Project;
  copy.id = S.nextId++;
  copy.number = nextFreeNumber();
  copy.name = src.name + ' (копия)';
  copy.date = 'Сегодня';
  if(!Array.isArray(copy.elements)) copy.elements = [];
  copy.elements.forEach(el => { el.id = S.nextElemId++; el.history = []; el.redo = []; renumberTree(el.root); });
  S.projects.unshift(copy);
  saveProjects();
  rerenderList();
  showToast('Проект скопирован');
}
export function copyCurrentProject(): void {
  closeProjectMenu();
  if(S.currentProjectId !== null) copyProject(S.currentProjectId);
}
export function confirmDeleteCurrentProject(): void {
  closeProjectMenu();
  const project = getCurrentProject();
  if(!project) return;
  openConfirm(DELETE_PROJECT_TEXT, () => {
    S.projects = S.projects.filter(p => p.id !== project.id);
    saveProjects();
    closeProjectScreen();
    rerenderList();
    showToast('Проект удалён');
  });
}
// Сводка проекта: количество, площади, длина профиля, подоконники, итоговая цена
export function openProjectSummaryFor(project: Project): void {
  const els = project.elements || [];
  const res = els.length ? calcProject(project) : null;
  const totals = res ? res.totals : { qty:0, area:0, glassArea:0, profileLen:0, sillLen:0 };
  const rows: [string, unknown][] = [
    ['Номер проекта', project.number != null ? project.number : project.id],
    ['Название проекта', project.name],
    ['Общее количество элементов', fmtNum(totals.qty, 0) + ' шт'],
    ['Общая площадь', fmtNum(totals.area, 2) + ' м²'],
    ['Площадь стекла', fmtNum(totals.glassArea, 1) + ' м²'],
    ['Длина профиля', fmtNum(totals.profileLen, 1) + ' м']
  ];
  (res ? res.lines : []).filter(l => l.name.indexOf('Подоконник') === 0)
    .forEach(l => rows.push([l.name, fmtNum(l.qty, 2) + ' м · ' + fmtMoney(l.sum)]));
  if(totals.sillLen > 1e-9) rows.push(['Подоконник, всего', fmtNum(totals.sillLen, 2) + ' м']);
  rows.push(['Итоговая цена', fmtSummaryMoney(res ? res.grand : 0)]);
  openSummaryRows('Сводка проекта', rows);
}
export function openProjectSummary(): void {
  closeProjectMenu();
  const project = getCurrentProject();
  if(project) openProjectSummaryFor(project);
}
