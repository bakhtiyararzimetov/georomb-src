// Общее изменяемое состояние приложения. В оригинале это были глобальные let-переменные;
// здесь они собраны в один объект, чтобы модули могли их менять (импортированный let переприсвоить нельзя).
import type { CuttingSettings, DimEditing, PriceSettings, Project, Remnant } from './types.ts';

export const S = {
  // новая установка начинается с пустого списка: демо-проекты после переустановки выглядели как
  // «вернувшиеся» удалённые проекты и смешивались с восстановленными. Примеры — «Настройки → Добавить примеры»
  projects: [] as Project[],
  nextId: 1,
  nextElemId: 1,
  nextNodeId: 1,
  currentProjectId: null as number | null,
  currentElementIndex: 0,
  selectedNid: null as number | null,
  editingElementId: null as number | null,   // элемент, редактируемый через форму (null — форма добавляет новый)
  dimEditing: null as DimEditing | null,

  // заполняются при запуске (main.ts → init), до этого — пустые значения
  prices: null as unknown as PriceSettings,
  catalogOff: new Set<string>(),              // отключённые цвета: ключи "mat:code"
  warehouseRemnants: [] as Remnant[],
  whNextId: 1,
  cutting: null as unknown as CuttingSettings
};

export const DEFAULT_W = 1500, DEFAULT_H = 1200, DEFAULT_QTY = 1;
/** Глубина полки отдельного подоконника, если её нет в данных (смета, раскрой, 3D), мм. */
export const DEFAULT_SILL_DEPTH = 200;
/** Хлыст по умолчанию, мм: пластик — 6500, алюминий — 6000. */
export const DEFAULT_UNIT_LENGTH = { pvc: 6500, alu: 6000 } as const;
