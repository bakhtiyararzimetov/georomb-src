// Общие заглушки для тестов модулей app/src в Node: localStorage в памяти и «пустой» DOM.
// Модули приложения обращаются к document только при вызове (тост, перерисовка), поэтому
// достаточно заглушки, которая принимает любые обращения и запоминает textContent/innerHTML.

export class MemoryStorage {
  data = new Map<string, string>();
  quotaBytes = Infinity;                       // для эмуляции QuotaExceededError
  get length(): number { return this.data.size; }
  key(i: number): string | null { return [...this.data.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string): void {
    const size = [...this.data.entries()].reduce((a, [kk, vv]) => a + (kk === k ? 0 : kk.length + vv.length), 0) + k.length + String(v).length;
    if(size > this.quotaBytes){ const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    this.data.set(k, String(v));
  }
  removeItem(k: string): void { this.data.delete(k); }
  clear(): void { this.data.clear(); }
}

export function installStorage(): MemoryStorage {
  const s = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
  return s;
}

export interface FakeEl {
  id: string; value: string; textContent: string; innerHTML: string; checked: boolean; disabled: boolean;
  files: unknown; style: Record<string, string>; [k: string]: unknown;
}

// объект, у которого любое отсутствующее свойство — «пустышка»: её можно вызвать, читать и присваивать ей
function sink(): unknown {
  const f = function(){ return p; };
  const p: unknown = new Proxy(f, { get: (_t, k) => k === Symbol.toPrimitive ? () => '' : (k === 'then' ? undefined : p), set: () => true, apply: () => p });
  return p;
}
function anything<T extends object>(o: T): T {
  return new Proxy(o, { get: (t, k) => (k in t || typeof k === 'symbol') ? (t as Record<string | symbol, unknown>)[k] : sink() });
}

/** DOM-заглушка: элементы по id создаются при первом обращении; values — начальные value полей. */
export function installDom(values: Record<string, string> = {}, checkedRadios: Record<string, string> = {}) {
  const els = new Map<string, FakeEl>();
  const classes = (): { add(...a: string[]): void; remove(...a: string[]): void; toggle(c: string, on?: boolean): boolean; contains(c: string): boolean } => {
    const set = new Set<string>();
    return {
      add: (...a) => a.forEach(c => set.add(c)), remove: (...a) => a.forEach(c => set.delete(c)),
      toggle: (c, on) => { const v = on === undefined ? !set.has(c) : on; if(v) set.add(c); else set.delete(c); return v; },
      contains: c => set.has(c)
    };
  };
  const mk = (id: string): FakeEl => anything({
    id, value: values[id] ?? '', textContent: '', innerHTML: '', checked: false, disabled: false, files: null,
    style: anything({}), dataset: {}, classList: classes(), children: [], parentNode: null, options: [], offsetTop: 0, scrollTop: 0,
    addEventListener() {}, removeEventListener() {}, click() {}, appendChild() {}, remove() {}, focus() {}, blur() {},
    setAttribute() {}, getAttribute() { return null; }, querySelector: () => mk(''), querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }; }
  }) as FakeEl;
  const getEl = (id: string) => { if(!els.has(id)) els.set(id, mk(id)); return els.get(id)!; };
  const doc = {
    getElementById: getEl,
    // как в браузере: textContent → innerHTML экранирует только & < > (и неразрывный пробел), кавычки — нет
    createElement: () => {
      const e = mk('');
      let text = '';
      Object.defineProperty(e, 'textContent', { get: () => text, set: (v: string) => { text = String(v); }, configurable: true });
      Object.defineProperty(e, 'innerHTML', {
        get: () => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;'),
        set: () => {}, configurable: true
      });
      return e;
    },
    querySelector: (sel: string) => {
      const m = /input\[name="([^"]+)"\]:checked/.exec(sel);
      if(m) return checkedRadios[m[1]] !== undefined ? { value: checkedRadios[m[1]], checked: true } : null;
      return mk('');
    },
    querySelectorAll: () => [],
    addEventListener() {}, body: mk('body'), documentElement: mk('html')
  };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  if(!('window' in globalThis)) Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true, writable: true });
  return { el: getEl, toast: () => getEl('toast').textContent };
}
