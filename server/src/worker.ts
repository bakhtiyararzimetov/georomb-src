// Отрисовка PDF в отдельном потоке: resvg синхронный (~0.2–0.5 с CPU на страницу) и иначе останавливает
// весь сервер — пока рисуется один проект, не отвечают ни другие боты, ни /health.
import { Worker } from 'node:worker_threads';
import type { PdfLang, Project } from '../../app/src/types.ts';

export const RENDER_TIMEOUT_MS = 60_000;

export function renderPdfInWorker(project: Project, lang: PdfLang = 'ru', timeoutMs = RENDER_TIMEOUT_MS): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./pdfWorker.ts', import.meta.url), { workerData: { project, lang } });
    const timer = setTimeout(() => { reject(new Error(`превышено время отрисовки (${timeoutMs / 1000} с)`)); void w.terminate(); }, timeoutMs);
    w.once('message', (pdf: Uint8Array) => { clearTimeout(timer); resolve(pdf); });
    w.once('error', err => { clearTimeout(timer); reject(err); });
    w.once('exit', code => { clearTimeout(timer); reject(new Error('поток отрисовки завершился с кодом ' + code)); });
  });
}
