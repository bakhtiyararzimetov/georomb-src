import { S } from '../state.ts';
import type { ColorOption, Mat, Project, WinElement } from '../types.ts';

// ===== Цвета профиля по материалу проекта (project.type: 'pvc' | 'alu') =====
// Коды и HEX подобраны по открытым RAL-справочникам и каталогу RENOLIT EXOFOL;
// используются как ориентир для интерфейса — перед производством сверяются по физическому образцу.
export const COLOR_OPTIONS: Record<Mat, ColorOption[]> = {
  pvc: [
    { code:'ral9016', name:'Белый (RAL 9016)',        hex:'#F6F6F6', ral:'RAL 9016' },
    { code:'ral9005', name:'Чёрный (RAL 9005)',        hex:'#0A0A0A', ral:'RAL 9005' },
    { code:'ral9001', name:'Кремовый (RAL 9001)',      hex:'#FDF4E3', ral:'RAL 9001' },
    { code:'ral8017', name:'Шоколад (RAL 8017)',       hex:'#44322D', ral:'RAL 8017' },
    { code:'ral7016', name:'Антрацит (RAL 7016)',      hex:'#293133', ral:'RAL 7016' },
    { code:'ral7021', name:'Чёрно-серый (RAL 7021)',   hex:'#23282B', ral:'RAL 7021' },
    { code:'ral1011', name:'Бежево-коричневый (RAL 1011)', hex:'#AF8A54', ral:'RAL 1011' },
    { code:'ral3005', name:'Винно-красный (RAL 3005)', hex:'#5E2028', ral:'RAL 3005' },
    { code:'oak_golden',  name:'Золотой дуб',  hex:'#B08D57', ral:'Renolit S30.30.11.0031 (≈RAL 8011)' },
    { code:'oak_rustic',  name:'Дуб рустик',   hex:'#5B4433', ral:'Renolit S30.30.91.0023 (≈RAL 8028)' },
    { code:'mahogany',    name:'Махагон',      hex:'#4C2F26', ral:'Renolit S30.30.11.0019 (≈RAL 8016)' },
    { code:'walnut',      name:'Орех',         hex:'#59351F', ral:'Renolit S30.30.11.0033 (≈RAL 8007)' },
    { code:'wenge',       name:'Венге',        hex:'#2E2420', ral:'требует уточнения артикула' },
    { code:'teak',        name:'Тик',          hex:'#8A6E4B', ral:'требует уточнения артикула' },
    { code:'ash',         name:'Ясень',        hex:'#C9BFA8', ral:'требует уточнения артикула' }
  ],
  // Алюминий: порошковая краска (RAL) и анодирование EURAS. У анодирования HEX официально нет —
  // previewHex только ориентир для схемы/кружка в интерфейсе.
  alu: [
    { code:'ral9016a', name:'Белый (RAL 9016)',              hex:'#F6F6F6', ral:'RAL 9016, порошок, глянец/мат' },
    { code:'ral9005a', name:'Чёрный матовый (RAL 9005 Matt)', hex:'#0A0A0A', ral:'RAL 9005 Matt, порошок, структура' },
    { code:'ral7016a', name:'Антрацит (RAL 7016)',           hex:'#293133', ral:'RAL 7016, порошок, структура' },
    { code:'ral7021a', name:'Чёрно-серый (RAL 7021)',        hex:'#23282B', ral:'RAL 7021, порошок, структура' },
    { code:'ral9006',  name:'Белый алюминий (RAL 9006)',     hex:'#A5A5A5', ral:'RAL 9006, порошок, металлик — только с прозрачным лаком', metallic:true },
    { code:'ral9007',  name:'Серый алюминий (RAL 9007)',     hex:'#8F8F8F', ral:'RAL 9007, порошок, металлик — только с прозрачным лаком', metallic:true },
    { code:'ral9022',  name:'Жемчужно-светло-серый (RAL 9022)', hex:'#9C9C9C', ral:'RAL 9022, порошок, металлик/перламутр', metallic:true },
    { code:'euras_c0',  name:'Серебро, анодир. (EURAS C-0)',        hex:null, previewHex:'#C8C8C6', ral:'EURAS C-0, анодирование', anodized:true },
    { code:'euras_c31', name:'Серебристая бронза (EURAS C-31)',     hex:null, previewHex:'#B8A88C', ral:'EURAS C-31, анодирование', anodized:true },
    { code:'euras_c32', name:'Светлая бронза (EURAS C-32)',         hex:null, previewHex:'#A8875C', ral:'EURAS C-32, анодирование', anodized:true },
    { code:'euras_c33', name:'Средняя бронза (EURAS C-33)',         hex:null, previewHex:'#7C5A3A', ral:'EURAS C-33, анодирование', anodized:true },
    { code:'euras_c34', name:'Тёмная бронза (EURAS C-34)',          hex:null, previewHex:'#4A3423', ral:'EURAS C-34, анодирование', anodized:true },
    { code:'euras_c35', name:'Чёрный, анодир. (EURAS C-35)',        hex:null, previewHex:'#1C1C1C', ral:'EURAS C-35, анодирование', anodized:true }
  ]
};

export function projectMat(project: Project | null | undefined): Mat {
  return (project && project.type === 'alu') ? 'alu' : 'pvc';
}
export function colorsForProject(project: Project | null | undefined): ColorOption[] {
  return COLOR_OPTIONS[projectMat(project)] || [];
}
export function findColor(project: Project | null | undefined, code: string | null | undefined): ColorOption | null {
  return colorsForProject(project).find(c => c.code === code) || null;
}
export function colorHex(c: ColorOption): string { return c.hex || c.previewHex || '#ffffff'; }
// цвет профиля для схемы: не выбран — белый; у анодирования HEX нет — берём приближённый previewHex
export function elementColorHex(e: WinElement | null | undefined, project: Project | null | undefined): string {
  const c = findColor(project, e && e.color);
  return c ? colorHex(c) : '#ffffff';
}

export const catalogIsOff = (mat: Mat, code: string): boolean => S.catalogOff.has(mat + ':' + code);

// цвета для ВЫБОРА в форме элемента: отключённые не показываем (кроме текущего выбранного);
// чем чаще цвет используется в проектах этого материала, тем он выше; при равенстве — порядок каталога.
// Если отключены все — показываем все.
export function pickableColors(project: Project | null | undefined, keepCode: string | null | undefined): ColorOption[] {
  const mat = projectMat(project);
  const all = colorsForProject(project);
  const use: Record<string, number> = {};
  S.projects.forEach(p => {
    if(projectMat(p) !== mat) return;
    (p.elements || []).forEach(e => { if(e.color) use[e.color] = (use[e.color] || 0) + 1; });
  });
  let list = all.filter(c => c.code === keepCode || !catalogIsOff(mat, c.code));
  if(!list.length) list = all;
  return list.map((c, i) => ({ c, i }))
    .sort((a, b) => ((use[b.c.code] || 0) - (use[a.c.code] || 0)) || (a.i - b.i))
    .map(x => x.c);
}
