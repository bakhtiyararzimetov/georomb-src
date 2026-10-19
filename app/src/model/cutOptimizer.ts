// Оптимизатор раскроя — правила romchi (smart_cut_new/CuttingOptimizer + WarehouseProfileMatcher). Чистая логика, без DOM.
//   • пропил — только между деталями: Σ деталей + (n − 1)·пропил ≤ хлыста. Упаковщики считают «деталь + пропил»
//     в хлысте длиной L + пропил — это то же условие;
//   • склад — отдельный шаг до раскроя: детали от длинных к коротким, каждая — туда, где останется меньше всего
//     (начатый остаток или новый), пропил между деталями, без правил подрезки и мин. обрезка;
//   • 5 лучших: меньше хлыстов → меньше остатков и пропилов (% от длины, деловые обрезки тоже) → больше со склада
//     → меньше новых обрезков → обрезки длиннее;
//   • без лимита времени: шаги поиска ограничены числом, поэтому результат одинаков на любом телефоне.

export const CUT_TOP = 5;            // сколько вариантов показывать
export const CUT_BUDGET_MS = 350;    // > 0 — полный поиск (перестановки, улучшение, перебор); 0 — быстрый (смета)
const RANDOM_ITERS = 600;            // перестановок на группу
const EXACT_NODES = 4000;            // узлов точного перебора на группу
const BIG_GROUP = 300, HUGE_GROUP = 1000;   // как в romchi: больше 300 деталей — только быстрые упаковщики и улучшение, больше 1000 — только FFD/BFD

export interface CutParams { k: number; minScrap: number; trimMax: number; }
export interface Scrap { id: number; uid: string; len: number; }
interface Bin { cuts: number[]; scrap?: Scrap; }
interface Candidate { name: string; desc: string; lb: number; bins: Bin[]; }
export interface CutPlan { cuts: number[]; len: number; scrap: Scrap | null; left: number; usable: boolean; }
export interface CutVariant {
  name: string; desc: string; lb: number; plans: CutPlan[];
  newBars: number; fromWh: number; wasteMm: number; kerfMm: number; totalMm: number; usedMm: number;
  lossPct: number;     // все остатки (и деловые) + пропилы, % от длины — второй ключ сортировки, как wastePercentage в romchi
  newScraps: number; newScrapsAvg: number; cutsN: number; wastePct: number; effPct: number; sig: string;
}
/**
 * proven — точный перебор доказал, что меньше хлыстов не бывает;
 * partial — очень много деталей: тяжёлые шаги пропущены, результат упрощённый (как в romchi).
 */
export interface CutResult { variants: CutVariant[]; tooLong: number[]; ms: number; proven: boolean; partial: boolean; }

type Counts = Map<number, number>;
function cutCounts(arr: number[]): Counts { const m: Counts = new Map(); arr.forEach(x => m.set(x, (m.get(x) || 0) + 1)); return m; }
function cutTake(m: Counts, len: number): void { const c = m.get(len) || 0; if(c > 1) m.set(len, c - 1); else m.delete(len); }
function cutFlat(m: Counts): number[] {
  const out: number[] = [];
  [...m.keys()].sort((a, b) => b - a).forEach(len => { for(let i = 0; i < (m.get(len) || 0); i++) out.push(len); });
  return out;
}
function cutRng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// точный подбор: набор с максимальной Σ(деталь + пропил) ≤ cap (рюкзак 0/1, количества — двоичным разбиением).
// Рюкзак идёт по целым мм (масштаб ×10/×100 замедлял подбор в 10–100 раз): дробная часть пропила (2,5 мм)
// отбрасывается, а настоящая сумма проверяется после сборки набора — так хлыст не переполнится,
// а точные укладки (3000 + 2995 при пропиле 2,5) не теряются.
function cutBestFill(m: Counts, cap: number, k: number, okLeft: ((left: number) => boolean) | null): number[] | null {
  if(cap <= 0) return null;
  const items: [number, number][] = [];
  [...m.keys()].sort((a, b) => b - a).forEach(len => {
    let c = Math.min(m.get(len) || 0, Math.floor(cap / (len + k) + 1e-9)), p = 1;
    while(c > 0){ const t = Math.min(p, c); items.push([len, t]); c -= t; p *= 2; }
  });
  if(!items.length) return null;
  const capI = Math.floor(cap + 1e-9);
  const wOf = (i: number) => Math.floor(items[i][0] + k + 1e-9) * items[i][1];
  const reach = new Uint8Array(capI + 1), from = new Int32Array(capI + 1);
  reach[0] = 1;
  for(let i = 0; i < items.length; i++){
    const w = wOf(i);
    for(let c = capI; c >= w; c--) if(!reach[c] && reach[c - w]){ reach[c] = 1; from[c] = i; }
  }
  for(let c = capI; c > 0; c--){
    if(!reach[c]) continue;
    const out: number[] = [];
    for(let x = c; x > 0; ){
      const i = from[x], [len, t] = items[i];
      for(let j = 0; j < t; j++) out.push(len);
      x -= wOf(i);
    }
    const left = cap - out.reduce((a, l) => a + l + k, 0);           // настоящий остаток, с дробным пропилом
    if(left < -1e-9 || (okLeft && !okLeft(left))) continue;
    return out;
  }
  return null;
}
// укладка по порядку: first fit / best fit
function cutPackOrder(flat: number[], L: number, k: number, best: boolean): Bin[] {
  const bins: { cuts: number[]; load: number }[] = [];
  for(const len of flat){
    let tgt: { cuts: number[]; load: number } | null = null, tgtLeft = Infinity;
    for(const b of bins){
      const left = L - b.load;
      if(left >= len + k){
        if(!best){ tgt = b; break; }
        if(left < tgtLeft){ tgt = b; tgtLeft = left; }
      }
    }
    if(!tgt){ tgt = { cuts:[], load:0 }; bins.push(tgt); }
    tgt.cuts.push(len); tgt.load += len + k;
  }
  return bins.map(b => ({ cuts:b.cuts }));
}
// хлыст за хлыстом точным подбором: 'max' — максимум, 'big' — длинная + добор, 'scrap' — остаток почти 0 или деловой
function cutPackFill(m0: Counts, L: number, k: number, mode: 'max' | 'big' | 'scrap', minScrap: number): Bin[] {
  const m = new Map(m0), bins: Bin[] = [];
  const okScrap = (left: number) => left <= 50 || left >= minScrap;
  while(m.size){
    let cuts: number[];
    if(mode === 'big'){
      const big = Math.max(...m.keys());
      cutTake(m, big);
      cuts = [big, ...(cutBestFill(m, L - big - k, k, null) || [])];
      cuts.slice(1).forEach(x => cutTake(m, x));
    }else{
      cuts = (mode === 'scrap' && cutBestFill(m, L, k, okScrap)) || cutBestFill(m, L, k, null) || [Math.max(...m.keys())];
      cuts.forEach(x => cutTake(m, x));
    }
    bins.push({ cuts });
  }
  return bins;
}
// Точный перебор (ветви и границы, «bin completion»): хлыст за хлыстом, первой — самая длинная деталь,
// добор — только «максимальные» наборы (в хлыст больше ничего не влезает). Ветка отсекается, если даже
// при идеальной укладке остатка хлыстов будет не меньше, чем в лучшем найденном решении.
// Возвращает решение лучше incumbent (или null) и признак, что перебор закончен (оптимум доказан).
function cutExact(m0: Counts, L: number, k: number, incumbent: number, lb: number, maxNodes: number): { bins: Bin[] | null; done: boolean } {
  let best: Bin[] | null = null, bestN = incumbent, timeUp = false, nodes = 0;
  const lens = [...m0.keys()].sort((a, b) => b - a);
  const cnt = lens.map(l => m0.get(l) || 0);
  let restW = 0; lens.forEach((l, i) => { restW += cnt[i] * (l + k); });
  const path: number[][] = [];
  // все максимальные наборы для свободного места cap (не больше 400 — дальше перебор слишком широк)
  const completions = (cap: number): number[][] => {
    const out: number[][] = [], cur: number[] = [];
    const rec = (i: number, left: number) => {
      if(out.length > 400) return;
      if(i >= lens.length){
        // максимальность: ни одна оставшаяся деталь уже не влезает
        for(let j = 0; j < lens.length; j++) if(cnt[j] > 0 && lens[j] + k <= left) return;
        out.push(cur.slice());
        return;
      }
      const w = lens[i] + k, maxN = Math.min(cnt[i], Math.floor(left / w));
      for(let n = maxN; n >= 0; n--){
        for(let t = 0; t < n; t++) cur.push(lens[i]);
        cnt[i] -= n;
        rec(i + 1, left - n * w);
        cnt[i] += n;
        cur.length -= n;
      }
    };
    rec(0, cap);
    return out;
  };
  const dfs = (used: number) => {
    if(timeUp) return;
    if(++nodes > maxNodes){ timeUp = true; return; }
    const first = cnt.findIndex(c => c > 0);
    if(first < 0){
      if(used < bestN){ bestN = used; best = path.map(c => ({ cuts:c.slice() })); }
      return;
    }
    if(used + Math.ceil(restW / L) >= bestN) return;
    const big = lens[first];
    cnt[first]--; restW -= big + k;
    const opts = completions(L - big - k)
      .map(c => ({ c, w:c.reduce((a, x) => a + x + k, 0) }))
      .sort((a, b) => b.w - a.w);
    for(const { c, w } of opts){
      c.forEach(x => { cnt[lens.indexOf(x)]--; });
      restW -= w;
      path.push([big, ...c]);
      dfs(used + 1);
      path.pop();
      restW += w;
      c.forEach(x => { cnt[lens.indexOf(x)]++; });
      if(timeUp || bestN <= lb) break;
    }
    cnt[first]++; restW += big + k;
  };
  dfs(0);
  return { bins:best, done:!timeUp };
}

// меньше хлыстов, при равенстве — остатки собраны в крупные куски
function cutScore(bins: Bin[], L: number, k: number): number {
  let sq = 0;
  bins.forEach(b => { const left = L - b.cuts.reduce((a, c) => a + c + k, 0); sq += left * left; });
  return bins.length * 1e15 - sq;
}
// поиск перестановками: сотни чуть перемешанных порядков
function cutPackRandom(m: Counts, L: number, k: number, iters: number, rnd: () => number): Bin[] | null {
  const base = cutFlat(m);
  if(base.length < 3) return null;
  let best: Bin[] | null = null, bestScore = Infinity;
  for(let it = 0; it < iters; it++){
    const arr = base.slice();
    const swaps = 1 + Math.floor(rnd() * Math.max(1, arr.length / 3));
    for(let s = 0; s < swaps; s++){
      const i = Math.floor(rnd() * arr.length), j = Math.min(arr.length - 1, i + 1 + Math.floor(rnd() * 5));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    const bins = cutPackOrder(arr, L, k, rnd() < 0.5);
    const sc = cutScore(bins, L, k);
    if(sc < bestScore){ best = bins; bestScore = sc; }
  }
  return best;
}
// улучшение: разгрузить самый пустой хлыст в остальные и убрать его
function cutPackImprove(bins0: Bin[], L: number, k: number): Bin[] {
  let bins = bins0.map(b => ({ cuts:b.cuts.slice() }));
  const load = (b: Bin) => b.cuts.reduce((a, c) => a + c + k, 0);
  let changed = true;
  while(changed){                                    // каждый проход убирает хлыст — конечен
    changed = false;
    bins.sort((a, b) => load(a) - load(b));
    for(let bi = 0; bi < bins.length && !changed; bi++){
      const others = bins.filter((_, j) => j !== bi), loads = others.map(load), plan: [number, number][] = [];
      let ok = true;
      for(const p of bins[bi].cuts.slice().sort((a, b) => b - a)){
        let t = -1, tl = Infinity;
        for(let j = 0; j < others.length; j++){
          const left = L - loads[j];
          if(left >= p + k && left < tl){ t = j; tl = left; }
        }
        if(t < 0){ ok = false; break; }
        plan.push([t, p]); loads[t] += p + k;
      }
      if(ok && plan.length){ plan.forEach(([t, p]) => others[t].cuts.push(p)); bins = others; changed = true; }
    }
  }
  return bins;
}
// склад — как WarehouseProfileMatcher.match/tryPlace в romchi: детали от длинных к коротким; деталь идёт туда,
// где после неё останется меньше всего — в начатый остаток (с пропилом перед ней) или в новый (без пропила);
// при равенстве — в начатый. Подрезки и мин. обрезка нет; остаток — любой длины > 0.
function cutMatchScraps(pieces: number[], scraps: Scrap[], k: number): { rest: number[]; bins: Bin[] } {
  const free = scraps.filter(s => s.len > 0).slice();
  const open: { scrap: Scrap; used: number; cuts: number[] }[] = [];
  const rest: number[] = [];
  pieces.slice().sort((a, b) => b - a).forEach(len => {
    let best = Infinity, plan = -1, tool = -1;
    open.forEach((o, i) => {
      const left = o.scrap.len - (o.used + k + len);
      if(left >= -1e-9 && left < best){ best = left; plan = i; }
    });
    free.forEach((s, i) => {
      const left = s.len - len;
      if(left >= -1e-9 && left < best){ best = left; tool = i; plan = -1; }
    });
    if(plan >= 0){ const o = open[plan]; o.used += k + len; o.cuts.push(len); }
    else if(tool >= 0){ const s = free.splice(tool, 1)[0]; open.push({ scrap: s, used: len, cuts: [len] }); }
    else rest.push(len);
  });
  return { rest, bins: open.map(o => ({ cuts: o.cuts, scrap: o.scrap })) };
}
// показатели хлыста — как StockCutPlan
function cutBinStats(cuts: number[], len: number, k: number, minScrap: number) {
  let total = 0, kerfs = 0;
  cuts.forEach((c, i) => {
    total += c;
    if(k > 0 && (i < cuts.length - 1 || len - total > k)){ total += k; kerfs += k; }
  });
  const left = Math.max(0, len - total);
  return { left, kerfs, used:total - kerfs, usable:left >= minScrap };
}
function cutEvaluate(v: Candidate, L: number, C: CutParams): CutVariant {
  let newBars = 0, fromWh = 0, waste = 0, kerfs = 0, total = 0, used = 0, scrapsN = 0, scrapsSum = 0, cutsN = 0;
  const plans: CutPlan[] = v.bins.map(b => {
    const len = b.scrap ? b.scrap.len : L;
    const cuts = b.cuts.slice().sort((a, c) => c - a);
    const st = cutBinStats(cuts, len, C.k, C.minScrap);
    if(b.scrap) fromWh++; else newBars++;
    total += len; used += st.used; kerfs += st.kerfs; cutsN += cuts.length;
    if(st.usable){ scrapsN++; scrapsSum += st.left; } else waste += st.left;
    return { cuts, len, scrap:b.scrap || null, left:st.left, usable:st.usable };
  });
  return {
    name:v.name, desc:v.desc, lb:v.lb, plans, newBars, fromWh, wasteMm:waste, kerfMm:kerfs, totalMm:total, usedMm:used,
    newScraps:scrapsN, newScrapsAvg:scrapsN ? Math.round(scrapsSum / scrapsN) : 0, cutsN,
    wastePct:total ? (waste + kerfs) / total * 100 : 0,
    lossPct:total ? (total - used) / total * 100 : 0,
    effPct:total ? used / total * 100 : 0,
    sig:plans.map(p => (p.scrap ? 's' + p.scrap.uid : 'n') + ':' + p.cuts.join(',')).sort().join('|')
  };
}
// порядок как selectTop5 в romchi: хлысты → % остатков и пропилов → со склада → новых обрезков → их средняя длина
function cutCompare(a: CutVariant, b: CutVariant): number {
  const loss = Math.round((a.lossPct - b.lossPct) * 1e6);
  return a.newBars - b.newBars || loss || b.fromWh - a.fromWh
      || a.newScraps - b.newScraps || b.newScrapsAvg - a.newScrapsAvg;
}

/**
 * pieces — длины деталей (мм), L — длина хлыста, scraps — остатки склада по одной штуке.
 * budgetMs = 0 — быстрый расчёт (для сметы): без перестановок и перебора; > 0 — полный поиск.
 * В обоих случаях результат зависит только от входных данных.
 */
export function cutOptimize(pieces: number[], L: number, C: CutParams, scraps: Scrap[], budgetMs: number): CutResult {
  const t0 = performance.now();
  const full = budgetMs > 0;
  const k = C.k, Lc = L + k;                       // вместимость для «деталь + пропил»: пропил только между деталями
  const tooLong = pieces.filter(x => x > L);
  const wh = cutMatchScraps(pieces.filter(x => x <= L), scraps, k);
  const m0 = cutCounts(wh.rest);
  const n = wh.rest.length;
  const rnd = cutRng(20240917);
  const cand: Candidate[] = [];
  let proven = false, partial = n > BIG_GROUP;
  let rest = 0; m0.forEach((c, len) => { rest += c * (len + k); });
  const lb = Math.ceil(rest / Lc - 1e-9);           // меньше хлыстов не бывает
  const add = (name: string, desc: string, bins: Bin[]) => cand.push({ name, desc, lb, bins:[...wh.bins, ...bins] });
  if(!m0.size){
    add(wh.bins.length ? 'Только склад' : 'Нет деталей', 'Все детали помещаются в остатки склада', []);
  }else{
    const packs: [string, string, () => Bin[]][] = [
      ['Первый подходящий (FFD)', 'От длинных к коротким, каждая деталь — в первый хлыст, где хватает места', () => cutPackOrder(cutFlat(m0), Lc, k, false)],
      ['Самый плотный (BFD)', 'Каждая деталь — в хлыст, где после неё останется меньше всего', () => cutPackOrder(cutFlat(m0), Lc, k, true)]
    ];
    if(n <= BIG_GROUP) packs.push(
      ['Длинная + добор', 'Самая длинная деталь и точный подбор остальных под длину хлыста', () => cutPackFill(m0, Lc, k, 'big', C.minScrap)],
      ['Максимальное заполнение', 'Каждый хлыст заполняется точным подбором до предела', () => cutPackFill(m0, Lc, k, 'max', C.minScrap)],
      ['Деловые обрезки', 'Плотно, а остаток — либо почти ноль, либо годный обрезок', () => cutPackFill(m0, Lc, k, 'scrap', C.minScrap)]
    );
    let best: Bin[] | null = null;
    const better = (bins: Bin[]) => !best || cutScore(bins, Lc, k) < cutScore(best, Lc, k);
    packs.forEach(([name, desc, fn]) => {
      const bins = fn();
      add(name, desc, bins);
      if(better(bins)) best = bins;
    });
    if(full && n <= BIG_GROUP){
      const rb = cutPackRandom(m0, Lc, k, RANDOM_ITERS, rnd);
      if(rb){
        add('Поиск перестановками', 'Сотни вариантов порядка деталей, выбран лучший', rb);
        if(better(rb)) best = rb;
      }
    }
    if(best && n <= HUGE_GROUP){
      const imp = cutPackImprove(best, Lc, k);
      add('Улучшение лучшего', 'Лучший вариант, из которого убраны лишние хлысты', imp);
      if(imp.length < (best as Bin[]).length) best = imp;
    }
    // точный перебор — только если до нижней границы ещё есть куда улучшать
    if(full && n <= BIG_GROUP && best && (best as Bin[]).length > lb){
      const ex = cutExact(m0, Lc, k, (best as Bin[]).length, lb, EXACT_NODES);
      if(ex.bins) add('Точный перебор', 'Перебор вариантов с отсечением заведомо худших: найдено меньше хлыстов', ex.bins);
      proven = ex.done;
    }else if(best && (best as Bin[]).length <= lb) proven = true;
  }
  const seen = new Set<string>(), variants: CutVariant[] = [];
  cand.map(v => cutEvaluate(v, L, C)).sort(cutCompare).forEach(v => {
    if(seen.has(v.sig) || variants.length >= CUT_TOP) return;
    seen.add(v.sig); variants.push(v);
  });
  return { variants, tooLong, ms:Math.round(performance.now() - t0), proven, partial };
}
