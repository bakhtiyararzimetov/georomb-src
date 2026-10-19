// Поток отрисовки (см. worker.ts): проект → PDF, байты передаются обратно без копирования.
import { parentPort, workerData } from 'node:worker_threads';
import type { PdfLang, Project } from '../../app/src/types.ts';
import { drawWindowAndMakePdf } from './pdf.ts';

const { project, lang } = workerData as { project: Project; lang: PdfLang };
const pdf = await drawWindowAndMakePdf(project, lang);
parentPort!.postMessage(pdf, [pdf.buffer as ArrayBuffer]);
