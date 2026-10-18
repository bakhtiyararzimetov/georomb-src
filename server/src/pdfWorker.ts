// Поток отрисовки (см. worker.ts): проект → PDF, байты передаются обратно без копирования.
import { parentPort, workerData } from 'node:worker_threads';
import type { Project } from '../../app/src/types.ts';
import { drawWindowAndMakePdf } from './pdf.ts';

const pdf = await drawWindowAndMakePdf(workerData as Project);
parentPort!.postMessage(pdf, [pdf.buffer as ArrayBuffer]);
