// Модель данных приложения. Формат совпадает с тем, что уже сохранено в localStorage
// (iwd.projects.v1) и в файлах резервной копии, поэтому поля и их значения менять нельзя.

export type Mat = 'pvc' | 'alu';
export type Dir = 'v' | 'h';                 // 'v' — вертикальный импост (дети рядом), 'h' — горизонтальный
export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type OpeningType = 'Turn' | 'Tilt' | 'TiltTurn' | 'Door' | 'Sliding' | 'FixSliding';
export type Fill = 'glass' | 'panelV' | 'panelH';
export type Divider = 'cap' | 'adapter';     // Interlock (0 мм) / Front Locking (6 мм) у раздвижных
export type ElementType = 'casement' | 'sliding' | 'sill';
export type Axis = 'width' | 'height';

export interface Opening { type: OpeningType; hinge?: Edge; }

/**
 * Узел дерева делений. Узел меняет вид на месте (лист ↔ ветка, см. splitNode), поэтому это один тип
 * с необязательными полями, а не объединение: у листа есть fill/opening/inner, у ветки — dir/children/sizes.
 */
export interface TreeNode {
  nid: number;
  kind: 'leaf' | 'branch';
  fill?: Fill;
  opening?: Opening | null;
  inner?: TreeNode;            // переплёт внутри створки
  dir?: Dir;
  children?: TreeNode[];
  sizes?: number[] | null;     // квоты детей, мм (null — поровну)
  dividers?: Divider[];        // разделители раздвижной ветки
}

export interface WinElement {
  id: number;
  type: ElementType;
  width: number | string;
  height: number | string;
  qty: number | string;
  color: string | null;
  glass?: string;
  sill?: boolean;
  sillLen?: number;            // м
  sillWidth?: number;          // см
  net?: boolean;               // москитные сетки на открывающихся створках
  root?: TreeNode | null;
  slidingTemplate?: string | null;
  dimG?: { width: boolean; height: boolean };
  history: string[];
  redo: string[];
}

export interface Project {
  id: number;
  number?: number;
  name: string;
  date: string;
  type?: Mat;
  phone?: string;
  address?: string;
  description?: string;
  elements: WinElement[];
  defaultColor?: string;
  defaultGlass?: string;
}

export interface Point { x: number; y: number; }
export type Quad = Point[];
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Ext { l: number; t: number; r: number; b: number; }

export interface Profile {
  mat: Mat;
  frame: number; mullion: number; wSash: number; dSash: number; bead: number;
  slidFrame: number; slidSash: number; lock: number; panelSlat: number;
  sashGap: number; sashB: number; slidGap: number; weld: number; glassGap: number;
  vis?: number;                // визуальное утолщение профиля (только для чертежа)
}

export interface LayoutLeaf { node: TreeNode; rect: Rect; quad: Quad; cell?: Rect; inner?: SubLayout; }
export interface MullionRect extends Rect { quad: Quad; div?: Divider; }
export interface SubLayout { leaves: LayoutLeaf[]; mullions: MullionRect[]; frameT?: number; }
export interface Layout extends SubLayout {
  W: number; H: number; inner: Rect; bead: number; profile: Profile; frameT: number; hasSill: boolean;
  allMullions: MullionRect[];
  slidingMat?: Mat;
  color?: string;
  glass?: string;
  elType?: ElementType;
}

export interface ColorOption {
  code: string; name: string; hex: string | null; previewHex?: string; ral: string;
  metallic?: boolean; anodized?: boolean;
}
export interface GlassType { code: string; name: string; tint: string; lt: number; desc: string; matte?: boolean; }

/**
 * Учёт отходов профиля в цене (как в romchi):
 *   none — без отходов; percent — процент от стоимости профиля;
 *   full — по полной длине (в цену идут целые хлысты); smart — по минимальным размерам
 *   (в цену идут куски короче мин. обрезка и пропилы, деловые обрезки — нет).
 */
export type WasteMode = 'none' | 'percent' | 'full' | 'smart';

export interface PriceSettings {
  profile: Record<Mat, Record<'frame' | 'mullion' | 'wSash' | 'dSash' | 'slidFrame' | 'slidSash', number>>;
  accessory: Record<'Turn' | 'TiltTurn' | 'Tilt' | 'Door' | 'Sliding', number>;
  glass: number;
  panel: Record<Mat, number>;
  sill: Record<number, number>;
  reinf: number;               // армирование ПВХ, за метр
  net: number;                 // москитная сетка, за м²
  waste: { mode: WasteMode; percent: number };
  tax: number;
  currency: string;
  decimals: number;
}

export interface Remnant { id: number; material: Mat; role: string; color: string; lengthMm: number; qty: number; }

export interface CuttingSettings {
  kerf: number; minRemnant: number; trimMax: number;
  unitLength: Record<Mat, number>;
  roleUnit: Record<Mat, Record<string, number>>;
  showAlgorithms: boolean;
  reinf: boolean;              // раскраивать армирование (только ПВХ)
  reinfOffset: number;         // армирование короче рамы и створки на столько мм с каждой стороны
}

/** Настройки раскроя стекла на листах. */
export interface GlassCutSettings {
  sheetW: number; sheetH: number;   // лист, мм
  edge: number;                     // обрезка кромки листа с каждой стороны, мм
  gap: number;                      // рез между стёклами, мм
  rotate: boolean;                  // можно поворачивать стекло на 90°
}

export type PdfLang = 'ru' | 'uz' | 'ky';
export interface PdfOptions { lang: PdfLang; prices: boolean; sizes: boolean; }

/** Ссылка на сегмент линейки: узел и индекс ячейки в нём. */
export interface NodeRef { nid: number; index: number; }
export type DimEditing = Axis | { nodes: NodeRef[]; axis: Axis; off: number };
