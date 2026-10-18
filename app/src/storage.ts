// Сохранение проектов в localStorage. Ключ не меняется — иначе пользователи потеряют проекты.
import { S } from './state.ts';
import type { Project } from './types.ts';
import { maxNodeId } from './model/tree.ts';

export const PROJECTS_STORAGE_KEY = 'iwd.projects.v1';

// история отмены (history / redo) не сохраняется — она нужна только в течение сессии
export const withoutHistory = (k: string, v: unknown): unknown => (k === 'history' || k === 'redo') ? undefined : v;

// подписчик на любые сохранения данных (автокопия в «Документы», features/backup.ts)
let changeListener: (() => void) | null = null;
export function onDataChanged(cb: () => void): void { changeListener = cb; }
export function notifyDataChanged(): void {
  try{ if(changeListener) changeListener(); }catch{ /* копия не должна мешать сохранению */ }
}

export function saveProjects(): void {
  try{
    localStorage.setItem(PROJECTS_STORAGE_KEY,
      JSON.stringify({ projects: S.projects, nextId: S.nextId, nextElemId: S.nextElemId }, withoutHistory));
  }catch{ /* localStorage недоступен или переполнен — работаем без сохранения */ }
  notifyDataChanged();
}

export function loadProjects(): void {
  try{
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if(raw){
      const d = JSON.parse(raw) as { projects?: unknown; nextId?: unknown; nextElemId?: unknown };
      if(d && Array.isArray(d.projects) && d.projects.every((p: unknown) => !!p && typeof p === 'object' && Number.isFinite((p as Project).id))){
        S.projects = d.projects as Project[];
        if(Number.isFinite(d.nextId))     S.nextId = d.nextId as number;
        if(Number.isFinite(d.nextElemId)) S.nextElemId = d.nextElemId as number;
      }
    }
  }catch{ /* повреждённые данные — остаёмся на проектах по умолчанию */ }
  try{
    S.projects.forEach(p => {
      if(!Array.isArray(p.elements)) p.elements = [];
      p.elements = p.elements.filter(e => e && typeof e === 'object');
      if(p.number == null) p.number = p.id;                                   // проекты без номера: номер = id
      (['phone', 'address', 'description'] as const).forEach(k => { if(typeof p[k] !== 'string') p[k] = ''; });
      p.elements.forEach(e => {
        e.history = []; e.redo = [];
        if(Number.isFinite(e.id)) S.nextElemId = Math.max(S.nextElemId, e.id + 1);
        S.nextNodeId = Math.max(S.nextNodeId, maxNodeId(e.root) + 1);         // новые узлы не должны повторять nid загруженных
      });
      S.nextId = Math.max(S.nextId, p.id + 1);
    });
  }catch{ /* частично повреждённые данные — оставляем как есть */ }
}

export function getCurrentProject(): Project | undefined {
  const p = S.projects.find(x => x.id === S.currentProjectId);
  if(p && !p.elements) p.elements = [];
  return p;
}
export function currentElement() {
  const project = getCurrentProject();
  return project ? project.elements[S.currentElementIndex] : null;
}
export function nextFreeNumber(): number {
  return S.projects.reduce((m, p) => Math.max(m, Number(p.number) || 0), 0) + 1;
}
