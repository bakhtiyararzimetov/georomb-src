// Примеры: готовые окна и двери. Собираются теми же функциями, что и в редакторе.
// Один раз заполняют пустой «Пример проекта»; потом — кнопкой «Добавить примеры» в Настройках.
import { S } from '../state.ts';
import type { ElementType, Opening, WinElement } from '../types.ts';
import { showToast } from '../ui/dom.ts';
import { OPENINGS } from '../data/profiles.ts';
import { applySlidingTemplate, ensureRoot, newLeaf, splitNode } from '../model/tree.ts';
import { nextFreeNumber, saveProjects } from '../storage.ts';
import { rerenderList } from './projects.ts';

const EXAMPLES_FLAG_KEY = 'iwd.examplesSeeded.v1';
const EXAMPLE_PROJECT_NAME = 'Пример проекта';
const openingOf = (tag: string): Opening => Object.assign({}, OPENINGS[tag]);
const kids = (e: WinElement) => e.root!.children!;

function makeExample(type: ElementType, w: number, h: number, qty: number, build?: (e: WinElement) => void): WinElement {
  const e: WinElement = { id: S.nextElemId++, type, width: w, height: h, qty, color: null, history: [], redo: [] };
  ensureRoot(e);                 // пустая рама с одним стеклом
  if(build) build(e);
  return e;
}
// [тип, ширина, высота, количество, сборка]
const EXAMPLE_SPECS: [ElementType, number, number, number, (e: WinElement) => void][] = [
  // 1. Окно 1500×1200: слева поворотная створка, справа глухое стекло
  ['casement', 1500, 1200, 2, e => {
    splitNode(e.root!, 'v', 2);
    kids(e)[0].opening = openingOf('TurnLeft');
  }],
  // 2. Дверь 800×2000: верх — стекло, низ — панель
  ['casement', 800, 2000, 1, e => {
    const sash = e.root!;
    sash.opening = openingOf('doorRight');
    const inner = newLeaf();
    splitNode(inner, 'h', 2);
    inner.sizes = [1200, 556];
    inner.children![1].fill = 'panelH';
    sash.inner = inner;
  }],
  // 3. Окно 1800×1700: фрамуга из двух стёкол, снизу глухое | поворотно-откидное | глухое
  ['casement', 1800, 1700, 1, e => {
    splitNode(e.root!, 'h', 2);
    e.root!.sizes = [400, 1300];
    splitNode(kids(e)[0], 'v', 2);
    splitNode(kids(e)[1], 'v', 3);
    kids(e)[1].children![1].opening = openingOf('tiltTurnLeft');
  }],
  // 4. Раздвижное 2400×1500 на 4 створки
  ['sliding', 2400, 1500, 3, e => applySlidingTemplate(e, 'sliding_4_b')],
  // 5. Балконный блок 2000×2200: дверь + поворотно-откидное окно
  ['casement', 2000, 2200, 1, e => {
    splitNode(e.root!, 'v', 2);
    e.root!.sizes = [800, 1200];
    kids(e)[0].opening = openingOf('doorLeft');
    kids(e)[1].opening = openingOf('tiltTurnRight');
  }],
  // 6. Трёхстворчатое 2100×1400: поворотное | глухое | поворотно-откидное
  ['casement', 2100, 1400, 1, e => {
    splitNode(e.root!, 'v', 3);
    kids(e)[0].opening = openingOf('TurnLeft');
    kids(e)[2].opening = openingOf('tiltTurnRight');
  }],
  // 7. Одностворчатое поворотно-откидное 900×1400
  ['casement', 900, 1400, 1, e => { e.root!.opening = openingOf('tiltTurnRight'); }]
];
const buildExampleElements = () => EXAMPLE_SPECS.map(([type, w, h, qty, build]) => makeExample(type, w, h, qty, build));

export function seedExamplesOnce(): void {
  try{ if(localStorage.getItem(EXAMPLES_FLAG_KEY) !== null) return; }catch{ /* покажем примеры в этой сессии */ }
  const p = S.projects.find(x => x.name === EXAMPLE_PROJECT_NAME && Array.isArray(x.elements) && x.elements.length === 0);
  if(p){
    p.type = p.type || 'pvc';
    p.elements = buildExampleElements();
    saveProjects();
  }
  try{ localStorage.setItem(EXAMPLES_FLAG_KEY, '1'); }catch{ /* без сохранения */ }
}
export function addExampleProject(): void {
  if(S.projects.some(p => p.name === EXAMPLE_PROJECT_NAME)){
    showToast('«' + EXAMPLE_PROJECT_NAME + '» уже есть. Сначала удалите его, потом можно добавить новый', 4500);
    return;
  }
  S.projects.unshift({ id: S.nextId++, number: nextFreeNumber(), date: 'Сегодня', type: 'pvc', name: EXAMPLE_PROJECT_NAME,
                       phone: '', address: '', description: '', elements: buildExampleElements() });
  saveProjects();
  rerenderList();
  showToast('Добавлен проект «' + EXAMPLE_PROJECT_NAME + '»');
}
