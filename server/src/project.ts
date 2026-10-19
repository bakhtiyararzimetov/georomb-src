// Разбор и проверка JSON проекта от бота. Формат — Project из app/src/types.ts (как в резервной копии
// приложения), но служебные поля (id, nid, history, redo, date) можно не присылать — заполняем сами.
// Всё, что нельзя нарисовать, отклоняется здесь с понятным сообщением (→ HTTP 400), до отрисовки.
import type { Dir, Divider, Edge, ElementType, Fill, Mat, Opening, OpeningType, Project, TreeNode, WinElement } from '../../app/src/types.ts';
import { isElementValid } from '../../app/src/model/history.ts';
import { renumberTree } from '../../app/src/model/tree.ts';

export const MAX_ELEMENTS = 50, MAX_NODES = 500, MAX_DEPTH = 20;
export const MIN_SIZE = 100, MAX_SIZE = 10000, MIN_SILL_SIZE = 10;
const MAX_TEXT = 200;

const ELEMENT_TYPES: readonly ElementType[] = ['casement', 'sliding', 'sill'];
const OPENING_TYPES: readonly OpeningType[] = ['Turn', 'Tilt', 'TiltTurn', 'Door', 'Sliding', 'FixSliding'];
const EDGES: readonly Edge[] = ['left', 'right', 'top', 'bottom'];
const FILLS: readonly Fill[] = ['glass', 'panelV', 'panelH'];
const DIRS: readonly Dir[] = ['v', 'h'];
const DIVIDERS: readonly Divider[] = ['cap', 'adapter'];

/** Ошибка во входных данных: сообщение уходит боту как есть. */
export class ProjectError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const fail = (msg: string): never => { throw new ProjectError(msg); };

function text(v: unknown, field: string): string | undefined {
  if(v === undefined || v === null) return undefined;
  if(typeof v !== 'string') return fail(`Поле ${field} должно быть строкой`);
  // по кодовым точкам, чтобы не разрезать эмодзи; одиночные суррогаты → U+FFFD (иначе encodeURIComponent бросит)
  return Array.from(v.toWellFormed()).slice(0, MAX_TEXT).join('');
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;
}

interface Walk { nodes: number; where: string; }

function parseOpening(v: unknown, w: Walk): Opening | null {
  if(v === undefined || v === null) return null;
  if(!isObj(v) || !oneOf(OPENING_TYPES, v.type)) return fail(`${w.where}: opening.type должен быть одним из ${OPENING_TYPES.join(', ')}`);
  if(v.hinge !== undefined && !oneOf(EDGES, v.hinge)) return fail(`${w.where}: opening.hinge должен быть одним из ${EDGES.join(', ')}`);
  return v.hinge === undefined ? { type: v.type } : { type: v.type, hinge: v.hinge };
}

function parseNode(v: unknown, depth: number, w: Walk): TreeNode {
  if(depth > MAX_DEPTH) return fail(`${w.where}: слишком большая глубина делений (не больше ${MAX_DEPTH})`);
  if(++w.nodes > MAX_NODES) return fail(`${w.where}: слишком много делений (не больше ${MAX_NODES} узлов)`);
  if(!isObj(v)) return fail(`${w.where}: узел root должен быть объектом`);
  const kind = v.kind === undefined ? (v.children !== undefined ? 'branch' : 'leaf') : v.kind;
  if(kind === 'leaf'){
    if(v.fill !== undefined && !oneOf(FILLS, v.fill)) return fail(`${w.where}: fill должен быть одним из ${FILLS.join(', ')}`);
    const node: TreeNode = { nid: 0, kind: 'leaf', fill: (v.fill as Fill | undefined) || 'glass', opening: parseOpening(v.opening, w) };
    if(v.inner !== undefined && v.inner !== null) node.inner = parseNode(v.inner, depth + 1, w);
    return node;
  }
  if(kind !== 'branch') return fail(`${w.where}: kind должен быть leaf или branch`);
  if(!oneOf(DIRS, v.dir)) return fail(`${w.where}: у ветки dir должен быть v (рядом) или h (друг над другом)`);
  if(!Array.isArray(v.children) || v.children.length < 2) return fail(`${w.where}: у ветки должно быть children — минимум 2 части`);
  const n = v.children.length;
  let sizes: number[] | null = null;
  if(v.sizes !== undefined && v.sizes !== null){
    if(!Array.isArray(v.sizes) || v.sizes.length !== n || !v.sizes.every(x => typeof x === 'number' && isFinite(x)))
      return fail(`${w.where}: sizes должен быть массивом из ${n} чисел (мм) или null`);
    sizes = v.sizes as number[];
  }
  const node: TreeNode = { nid: 0, kind: 'branch', dir: v.dir, sizes, children: v.children.map(c => parseNode(c, depth + 1, w)) };
  if(v.dividers !== undefined){
    if(!Array.isArray(v.dividers) || v.dividers.length !== n - 1 || !v.dividers.every(d => oneOf(DIVIDERS, d)))
      return fail(`${w.where}: dividers должен быть массивом из ${n - 1} значений cap/adapter`);
    node.dividers = v.dividers as Divider[];
  }
  return node;
}

function parseElement(v: unknown, i: number, project: Project): WinElement {
  const where = `Элемент ${i + 1}`;
  if(!isObj(v)) return fail(`${where}: должен быть объектом`);
  const type = v.type === undefined ? 'casement' : v.type;
  if(!oneOf(ELEMENT_TYPES, type)) return fail(`${where}: type должен быть одним из ${ELEMENT_TYPES.join(', ')}`);
  const min = type === 'sill' ? MIN_SILL_SIZE : MIN_SIZE;
  const size = (val: unknown, label: string): number => {
    const x = num(val);
    if(!(x >= min && x <= MAX_SIZE)) return fail(`${where}: ${label} должна быть числом от ${min} до ${MAX_SIZE} мм`);
    return x;
  };
  const width = size(v.width, 'ширина'), height = size(v.height, 'высота');
  const qty = v.qty === undefined ? 1 : num(v.qty);
  if(!(qty > 0 && qty <= 10000)) return fail(`${where}: qty должно быть числом больше 0`);
  const e: WinElement = {
    id: i + 1, type, width, height, qty,
    color: text(v.color, 'color') ?? null,
    history: [], redo: []
  };
  const glass = text(v.glass, 'glass');
  if(glass) e.glass = glass;
  if(v.net === true) e.net = true;
  if(v.sill === true && type !== 'sill'){          // у отдельного подоконника своего подоконника нет
    e.sill = true;
    if(typeof v.sillLen === 'number') e.sillLen = v.sillLen;
    if(typeof v.sillWidth === 'number') e.sillWidth = v.sillWidth;
  }
  if(v.root !== undefined && v.root !== null){
    e.root = parseNode(v.root, 1, { nodes: 0, where });
    renumberTree(e.root);
  }
  if(!isElementValid(e, project)) return fail(`${where}: конструкцию нельзя построить — проверьте размеры частей (sizes) и профили`);
  return e;
}

/** JSON от бота → проект GeoRomb. Бросает ProjectError с сообщением для разработчика бота. */
export function parseProject(body: unknown): Project {
  if(!isObj(body)) return fail('Тело запроса должно быть JSON-объектом проекта');
  if(!Array.isArray(body.elements) || body.elements.length === 0) return fail('Поле elements должно быть непустым массивом элементов (окон, дверей)');
  if(body.elements.length > MAX_ELEMENTS) return fail(`Слишком много элементов: не больше ${MAX_ELEMENTS}`);
  if(body.type !== undefined && !oneOf<Mat>(['pvc', 'alu'], body.type)) return fail('Поле type должно быть pvc или alu');
  const project: Project = {
    id: 1,
    name: text(body.name, 'name') || 'Проект',
    date: text(body.date, 'date') || new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
    type: (body.type as Mat | undefined) || 'pvc',
    elements: []
  };
  for(const k of ['phone', 'address', 'description', 'defaultColor', 'defaultGlass'] as const){
    const t = text(body[k], k);
    if(t) project[k] = t;
  }
  project.elements = body.elements.map((el, i) => parseElement(el, i, project));
  return project;
}
