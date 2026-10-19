// ?format=georomb: файл для «Импорт проектов» в приложении — тот же формат, что и резервная копия
// (backup.ts: "window-projects-backup", version 1), с одним проектом. Бот отправляет его вместе с PDF;
// когда клиент заказывает, файл открывают в приложении — и сразу есть смета, раскрой и склад.
import type { Project } from '../../app/src/types.ts';

// как withoutHistory в app/src/storage.ts (тот модуль тянет за собой состояние приложения)
const withoutHistory = (k: string, v: unknown): unknown => (k === 'history' || k === 'redo') ? undefined : v;

export function projectImportFile(project: Project) {
  return {
    format: 'window-projects-backup', version: 1, exportedAt: new Date().toISOString(), source: 'georomb-api',
    projects: [JSON.parse(JSON.stringify(project, withoutHistory)) as Project]
  };
}
