// Язык и состав PDF (как в romchi: «Выберите язык PDF», «Показывать цены?», «Показывать размеры?»).
// Переводятся подписи PDF; названия цветов, стёкол и проектов остаются как введены.
import type { PdfLang, PdfOptions } from '../types.ts';
import { $ } from '../ui/dom.ts';

const OPT_KEY = 'iwd.pdfOptions.v1';
export const PDF_LANGS: [PdfLang, string][] = [['ru', 'Русский'], ['uz', 'Oʻzbekcha'], ['ky', 'Кыргызча']];

const DICT = {
  elements:        ['элементов', 'ta element', 'элемент'],
  pcsTotal:        ['штук всего', 'jami dona', 'бардыгы даана'],
  totalArea:       ['общая площадь', 'umumiy maydon', 'жалпы аянт'],
  composition:     ['Состав проекта', 'Loyiha tarkibi', 'Долбоордун курамы'],
  compositionCont: ['Состав проекта (продолжение)', 'Loyiha tarkibi (davomi)', 'Долбоордун курамы (уландысы)'],
  element:         ['Элемент', 'Element', 'Элемент'],
  size:            ['Размер', 'Oʻlcham', 'Өлчөм'],
  qty:             ['Количество', 'Soni', 'Саны'],
  construction:    ['Конструкция', 'Konstruksiya', 'Конструкция'],
  slidingShort:    ['Раздвижная', 'Surilma', 'Жылма'],
  casementShort:   ['Створная', 'Ochiladigan', 'Ачылуучу'],
  area:            ['Площадь', 'Maydon', 'Аянт'],
  glassColor:      ['Цвет окна', 'Oyna rangi', 'Айнектин түсү'],
  sill:            ['Подоконник', 'Podokonnik', 'Подоконник'],
  sashes:          ['Створки', 'Tabaqalar', 'Канаттар'],
  andMore:         ['… и ещё', '… va yana', '… жана дагы'],
  net:             ['Москитная сетка', 'Chivin toʻri', 'Чиркей тору'],
  price:           ['Цена', 'Narx', 'Баасы'],
  pcs:             ['шт', 'dona', 'даана'],
  mm:              ['мм', 'mm', 'мм'],
  m:               ['м', 'm', 'м'],
  cm:              ['см', 'sm', 'см'],
  alu:             ['Алюминий', 'Alyuminiy', 'Алюминий'],
  pvc:             ['ПВХ', 'PVX', 'ПВХ'],
  typeSill:        ['Подоконник', 'Podokonnik', 'Подоконник'],
  typeSliding:     ['Раздвижная конструкция', 'Surilma konstruksiya', 'Жылма конструкция'],
  typeCasement:    ['Створная конструкция', 'Ochiladigan konstruksiya', 'Ачылуучу конструкция'],
  panelV:          ['панель, вертикальные полосы', 'panel, vertikal chiziqlar', 'панель, тик тилкелер'],
  panelH:          ['панель, горизонтальные полосы', 'panel, gorizontal chiziqlar', 'панель, туурасынан тилкелер'],
  fixedGlass:      ['глухое стекло', 'ochilmaydigan oyna', 'ачылбас айнек'],
  turn:            ['поворотная, петли ', 'buriladigan, petlyalar ', 'бурулма, илгичтер '],
  tilt:            ['откидная', 'qiya ochiladigan', 'жантайма'],
  tiltTurn:        ['поворотно-откидная, петли ', 'burilib-qiya ochiladigan, petlyalar ', 'бурулуп-жантайма, илгичтер '],
  door:            ['дверь, петли ', 'eshik, petlyalar ', 'эшик, илгичтер '],
  slidingLeaf:     ['раздвижная, ручка ', 'surilma, tutqich ', 'жылма, тутка '],
  fix:             ['глухая', 'ochilmaydigan', 'ачылбас'],
  sash:            ['створка', 'tabaqa', 'канат'],
  left:            ['слева', 'chapda', 'солдо'],
  right:           ['справа', 'oʻngda', 'оңдо'],
  // смета
  estimate:        ['Смета', 'Smeta', 'Смета'],
  colName:         ['Название', 'Nomi', 'Аталышы'],
  colQty:          ['Кол-во', 'Soni', 'Саны'],
  colUnit:         ['Ед.', 'Birl.', 'Бирд.'],
  colSum:          ['Сумма', 'Summa', 'Сумма'],
  subtotal:        ['Всего', 'Jami', 'Бардыгы'],
  tax:             ['Налог', 'Soliq', 'Салык'],
  grand:           ['Итого', 'Umumiy', 'Жыйынтык'],
  // раскрой профиля
  cutHeader:       ['Раскрой', 'Kesish', 'Кесүү'],
  cutTitle:        ['Раскрой профиля', 'Profil kesish sxemasi', 'Профилди кесүү схемасы'],
  page:            ['стр.', 'bet', 'бет'],
  projectNo:       ['Проект №', 'Loyiha №', 'Долбоор №'],
  kerf:            ['пропил', 'arra qalinligi', 'араа калыңдыгы'],
  minScrap:        ['мин. обрезок', 'min. qoldiq', 'мин. калдык'],
  newBars:         ['Новых хлыстов', 'Yangi profillar', 'Жаңы профилдер'],
  fromWh:          ['Со склада', 'Ombordan', 'Кампадан'],
  fromWhLow:       ['со склада', 'ombordan', 'кампадан'],
  waste:           ['отход', 'chiqindi', 'калдык'],
  scraps:          ['деловые обрезки', 'foydali qoldiqlar', 'пайдалуу калдыктар'],
  scrapsShort:     ['обрезков', 'qoldiq', 'калдык'],
  cuts:            ['резов', 'kesim', 'кесүү'],
  bar:             ['Хлыст', 'Profil', 'Профиль'],
  usage:           ['использование', 'foydalanish', 'пайдалануу'],
  notCut:          ['Не раскроены (длиннее хлыста)', 'Kesilmadi (profildan uzun)', 'Кесилген жок (профилден узун)'],
  whRemnant:       ['остаток склада №', 'ombor qoldigʻi №', 'кампа калдыгы №'],
  // стекло
  glassTitle:      ['Стёкла для стекольщика', 'Oynachi uchun oynalar', 'Айнекчи үчүн айнектер'],
  glasses:         ['Стёкла', 'Oynalar', 'Айнектер'],
  nets:            ['Москитные сетки', 'Chivin toʻrlari', 'Чиркей торлору'],
  wxh:             ['Ширина × высота', 'Eni × boʻyi', 'Туурасы × бийиктиги'],
  sheetCut:        ['Раскрой стекла на листах', 'Oynani listlarga kesish', 'Айнекти барактарга кесүү'],
  sheet:           ['Лист', 'List', 'Барак'],
  sheets:          ['листов', 'list', 'барак'],
  edge:            ['кромка', 'chet', 'чет'],
  cut:             ['рез', 'kesim', 'кесүү'],
  tooBig:          ['Не помещаются на лист', 'Listga sigʻmaydi', 'Баракка батпайт'],
  total:           ['Всего', 'Jami', 'Бардыгы']
} as const;
export type PdfKey = keyof typeof DICT;

// подписи ролей профиля (раскрой) и строк сметы
const ROLE: Record<string, [string, string, string]> = {
  frame:['Рама', 'Rama', 'Рама'], mullion:['Импост', 'Impost', 'Импост'],
  wSash:['Створка окна', 'Deraza tabaqasi', 'Терезе канаты'], dSash:['Створка двери', 'Eshik tabaqasi', 'Эшик канаты'],
  slidFrame:['Рама (раздвижная)', 'Rama (surilma)', 'Рама (жылма)'], slidSash:['Створка (раздвижная)', 'Tabaqa (surilma)', 'Канат (жылма)'],
  bead:['Штапик', 'Shtapik', 'Штапик'], panel:['Панель (планки)', 'Panel (lambri)', 'Панель (ламбри)'],
  sill:['Подоконник', 'Podokonnik', 'Подоконник'], reinf:['Армирование', 'Metall (armatura)', 'Металл (арматура)'],
  net:['Профиль москитной сетки', 'Setka profili', 'Тор профили']
};
const LINE: Record<string, [string, string, string]> = {
  'Рама':['Рама', 'Rama', 'Рама'], 'Средник':['Средник', 'Impost', 'Импост'],
  'Оконная рама':['Оконная рама', 'Deraza tabaqasi', 'Терезе канаты'], 'Дверной пояс':['Дверной пояс', 'Eshik tabaqasi', 'Эшик канаты'],
  'Раздвижная рама':['Раздвижная рама', 'Surilma rama', 'Жылма рама'], 'Раздвижная лента':['Раздвижная лента', 'Surilma tabaqa', 'Жылма канат'],
  'Армирование':['Армирование', 'Metall (armatura)', 'Металл (арматура)'],
  'Поворот':['Поворот', 'Buriladigan', 'Бурулма'], 'Наклон и поворот':['Наклон и поворот', 'Burilib-qiya', 'Бурулуп-жантайма'],
  'Наклон':['Наклон', 'Qiya', 'Жантайма'], 'Дверь':['Дверь', 'Eshik', 'Эшик'], 'Раздвижной':['Раздвижной', 'Surilma', 'Жылма'],
  'Стекло':['Стекло', 'Oyna', 'Айнек'], 'Панель':['Панель', 'Panel', 'Панель'], 'Москитная сетка':['Москитная сетка', 'Chivin toʻri', 'Чиркей тору']
};
const IDX: Record<PdfLang, number> = { ru:0, uz:1, ky:2 };

const opts: PdfOptions = loadPdfOptions();
function loadPdfOptions(): PdfOptions {
  const d: PdfOptions = { lang:'ru', prices:false, sizes:true };
  try{
    const s = JSON.parse(localStorage.getItem(OPT_KEY) || 'null') as Partial<PdfOptions> | null;
    if(s && typeof s === 'object'){
      if(s.lang === 'ru' || s.lang === 'uz' || s.lang === 'ky') d.lang = s.lang;
      if(typeof s.prices === 'boolean') d.prices = s.prices;
      if(typeof s.sizes === 'boolean') d.sizes = s.sizes;
    }
  }catch{ /* по умолчанию */ }
  return d;
}
export const pdfOpts = (): PdfOptions => opts;
export const pdfT = (k: PdfKey): string => DICT[k][IDX[opts.lang]];
export const pdfRole = (role: string, ru: string): string => ROLE[role] ? ROLE[role][IDX[opts.lang]] : ru;
// «Подоконник, 20 см», «Отходы профиля, 3%» — переводится начало, число остаётся
export function pdfLineName(name: string): string {
  if(opts.lang === 'ru') return name;
  if(LINE[name]) return LINE[name][IDX[opts.lang]];
  const sill = /^Подоконник, (\d+) см$/.exec(name);
  if(sill) return pdfT('sill') + ', ' + sill[1] + ' ' + pdfT('cm');
  if(name.startsWith('Отходы профиля')){
    const uz = opts.lang === 'uz';
    return (uz ? 'Profil chiqindisi' : 'Профиль калдыгы') + name.slice('Отходы профиля'.length)
      .replace('(по полной длине)', uz ? '(toʻliq uzunlik boʻyicha)' : '(толук узундугу боюнча)')
      .replace('(по мин. размерам)', uz ? '(min. oʻlchamlar boʻyicha)' : '(мин. өлчөмдөр боюнча)');
  }
  return name;
}

// ===== шторка выбора языка и состава =====
let pending: (() => void) | null = null;
/** what — для какого PDF: у проекта есть цены и размеры, у раскроя и стекла — только язык. */
export function openPdfOptions(what: 'project' | 'other', run: () => void): void {
  pending = run;
  $('pdfOptLangs').innerHTML = PDF_LANGS.map(([code, label]) => `
      <label class="radio-opt">
        <input type="radio" name="pdfLang" value="${code}"${opts.lang === code ? ' checked' : ''}>
        <span class="radio-dot"></span>${label}
      </label>`).join('');
  $('pdfOptProject').style.display = what === 'project' ? '' : 'none';
  ($('pdfOptPrices') as HTMLInputElement).checked = opts.prices;
  ($('pdfOptSizes') as HTMLInputElement).checked = opts.sizes;
  $('pdfOptBackdrop').classList.add('open');
}
export function closePdfOptions(): void { $('pdfOptBackdrop').classList.remove('open'); pending = null; }
export function confirmPdfOptions(): void {
  const r = document.querySelector<HTMLInputElement>('input[name="pdfLang"]:checked');
  if(r && (r.value === 'ru' || r.value === 'uz' || r.value === 'ky')) opts.lang = r.value;
  if($('pdfOptProject').style.display !== 'none'){
    opts.prices = ($('pdfOptPrices') as HTMLInputElement).checked;
    opts.sizes = ($('pdfOptSizes') as HTMLInputElement).checked;
  }
  try{ localStorage.setItem(OPT_KEY, JSON.stringify(opts)); }catch{ /* без сохранения */ }
  const run = pending;
  closePdfOptions();
  if(run) run();
}
