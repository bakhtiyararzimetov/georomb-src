# Window PDF API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HTTP API `POST /api/generate-window-pdf`: принимает проект GeoRomb в JSON и сразу отдаёт PDF с чертежами (или JSON с координатами при `?format=json`) — для WhatsApp-бота другого разработчика.

**Architecture:** Папка `server/` на Node + TypeScript (запуск `.ts` напрямую, как `backend/`), голый `node:http`. Чертёж — тот же `computeLayout` + `buildSvg` из `app/src`, страница A4 собирается как SVG, растеризуется `@resvg/resvg-js` (шрифт DejaVu Sans из `dejavu-fonts-ttf`, кириллица) и кладётся в PDF через `pdf-lib`.

**Tech Stack:** Node 26 (type stripping), `node:test`, `@resvg/resvg-js`, `pdf-lib`, `dejavu-fonts-ttf`.

**Spec:** дизайн согласован в чате 2026-10-18 (пользователь одобрил и попросил остальные решения принять самостоятельно).

## Global Constraints

- Формат входа — `Project` из `app/src/types.ts` (как в резервной копии приложения); `name`, `date`, `id`, `qty`, `color`, `history`, `redo`, `nid` необязательны — сервер заполняет сам.
- Ответ PDF: `200`, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="georomb.pdf"; filename*=UTF-8''<имя проекта>.pdf`.
- Ошибки — JSON `{ "error": "<код>", "message": "<по-русски>" }`, `Content-Type: application/json; charset=utf-8`: `invalid_json` 400, `invalid_project` 400, `payload_too_large` 413 (тело > 1 МБ), `not_found` 404, `method_not_allowed` 405, `pdf_generation_failed` 500.
- Лимиты: элементов 1..50, ширина/высота 100..10000 мм, узлов дерева ≤ 500, глубина ≤ 20.
- Поведение приложения не меняется (только перенос функций и необязательные параметры).
- Порт: `PORT` из окружения, по умолчанию 3000. Цены и смета — не в этой задаче.

## Review Focus

- Битая геометрия (импост шире окна, квоты ≤ 0) → 400 `invalid_project`, а не 500 и не кривой PDF — тест в Task 2.
- Огромное/глубокое дерево → 400 до отрисовки — тест в Task 2.
- Тело > 1 МБ → 413, сервер не падает — тест в Task 4.
- Кириллица в имени проекта → корректный `filename*` — тест в Task 4.
- Исключение внутри отрисовки → 500 JSON, процесс жив — тест в Task 4 (через подмену функции отрисовки).

---

### Task 1: Отрисовка из app/src работает в Node

**Files:**
- Create: `app/src/render/drawingSvg.ts` — перенос `pdfSvgFromOut` (→ `drawingSvg`) и `pdfLeafDesc` (→ `leafDesc`) из `features/pdf.ts`
- Modify: `app/src/features/pdf.ts` (импорт вместо локальных функций), `app/src/render/svg.ts:18` (`globalThis.devicePixelRatio`), `app/src/model/history.ts:41` (`isElementValid(e, project?)`)
- Test: `server/test/drawing.test.ts`

**Interfaces:**
- Produces: `drawingSvg(out: Layout, pxW: number, pxH: number, lineW: number): { svg; w; h; padX }`, `leafDesc(node: TreeNode): string`, `isElementValid(e: WinElement, project?: Project | null): boolean`

- [ ] Test: импорт `buildSvg`/`layoutForDrawing` в Node, `drawingSvg` для 1500×1200 с двумя створками содержит `<svg` и `width="…"`; `leafDesc` для `{type:'Turn',hinge:'left'}` = `'Поворотная левая'`-подобная строка из `pdfT`
- [ ] Run `node --test server/test/` → FAIL (нет модуля)
- [ ] Implement перенос; `npm run typecheck` зелёный
- [ ] Run → PASS

### Task 2: Проверка входного JSON

**Files:** Create `server/src/project.ts`; Test `server/test/project.test.ts`

**Interfaces:** Produces `class ProjectError extends Error`, `parseProject(body: unknown): Project` (нормализует: дефолты, `renumberTree`, `isElementValid(e, project)`)

- [ ] Tests: валидный пример → `elements.length`; не объект → ProjectError; пустой `elements`; 51 элемент; ширина `50` и `"abc"`; неверный `opening.type`; ветка без `children`; 501 узел; глубина 21; импост с `sizes:[0, 1500]` → ProjectError с номером элемента в сообщении
- [ ] FAIL → implement → PASS

### Task 3: PDF и JSON-раскладка

**Files:** Create `server/src/pdf.ts` (`drawWindowAndMakePdf`), `server/src/page.ts` (`elementPageSvg`), `server/src/layoutJson.ts`; Test `server/test/pdf.test.ts`

**Interfaces:**
- Produces: `elementPageSvg(project: Project, idx: number): string` (A4 1240×1754: шапка, чертёж, размерные цепочки `globalChain`, таблица), `drawWindowAndMakePdf(project: Project): Promise<Uint8Array>`, `projectLayoutJson(project: Project): LayoutJson` (`{ name, elements: [{ index, type, width, height, qty, frame, leaves:[{ x,y,w,h, fill, opening }], mullions:[{x,y,w,h}] }] }`, мм, без визуального утолщения)

- [ ] Tests: PDF начинается с `%PDF-`, `PDFDocument.load` → страниц = элементов; страница SVG содержит `1500` и `1200`; JSON: 2 листа и 1 импост для окна из двух частей
- [ ] FAIL → implement → PASS

### Task 4: HTTP-сервер, README, пример

**Files:** Create `server/src/app.ts` (`createApp(deps?)`), `server/src/main.ts`, `server/README.md`, `server/examples/project.json`, `server/tsconfig.json`; Modify `package.json` (scripts `server`, `test`, typecheck), Test `server/test/app.test.ts`

**Interfaces:** `createApp(deps?: { makePdf?: (p: Project) => Promise<Uint8Array> }): http.Server`

- [ ] Tests: 200 + заголовки + `%PDF`; `?format=json` → 200 JSON; битый JSON → 400 `invalid_json`; плохой проект → 400; > 1 МБ → 413; GET → 405; `/x` → 404; `makePdf` бросает → 500 `pdf_generation_failed`; кириллическое имя → `filename*=UTF-8''%D0%...`
- [ ] FAIL → implement → PASS; `npm run typecheck`; ручной curl с примером
