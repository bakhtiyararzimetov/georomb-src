od# API: PDF окна для WhatsApp-бота

Бот отправляет параметры окна в JSON, а API сразу отвечает готовым PDF: одна страница A4 на каждое окно или дверь, на странице чертёж с размерами и список створок. Чертёж тот же, что в приложении GeoRomb.

## Запуск

```bash
npm install
npm run server                 # http://0.0.0.0:3000/api/v1/generate-window-pdf
PORT=8080 npm run server       # другой порт
npm test                       # тесты API
```

Настройки задаются переменными окружения или в файле `.env` (образец — [.env.example](../.env.example)):

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` | адрес сервера |
| `API_KEYS` | пусто | ключи доступа через запятую; пусто — API открыт всем (только для своего компьютера) |
| `RATE_LIMIT` | `60` | запросов в минуту на ключ (без ключей — на IP); `0` — без лимита |
| `PUBLIC_URL` | пусто | внешний адрес сервера (`https://api.example.com`) для документации `/docs` |
| `TRUST_PROXY` | `0` | `1` — сервер стоит за своим прокси (nginx, Render, Railway), IP клиента берётся из `X-Forwarded-For` |

Ключ создаётся командой `npm run api-key` (получится `gr_…`). Каждому боту лучше выдать свой ключ: у каждого будет свой лимит, и один ключ можно отключить, не трогая остальные.

### Docker

```bash
docker build -t georomb-api .
docker run -p 3000:3000 -e API_KEYS=<ключ> georomb-api
```

В образе только сервер и нужные ему файлы `app/src`; контейнер проверяет себя через `/health` и при остановке дорисовывает начатые PDF.

Нужен Node.js 26 или новее: он запускает `.ts` без сборки.

## Запрос

`POST /api/v1/generate-window-pdf`, заголовок `Content-Type: application/json`, тело — проект (формат ниже).

| Параметр | Ответ |
|---|---|
| без параметра | `200`, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="georomb.pdf"; filename*=UTF-8''<имя проекта>.pdf` |
| `?format=json` | `200`, JSON с координатами рамы, проёмов и импостов в мм (если бот хочет нарисовать сам) |
| `?lang=uz` или `?lang=ky` | подписи PDF на узбекском или кыргызском (по умолчанию `ru`); названия цветов и стёкол остаются как есть |

Заголовки запроса:
- `X-API-Key: <ключ>` или `Authorization: Bearer <ключ>`, если на сервере задан `API_KEYS`;
- `X-Request-Id: <ваш номер>` — необязательно. Он вернётся в ответе и попадёт в лог сервера; без него сервер присвоит свой. По нему удобно искать запрос в логе, когда клиент жалуется.

В каждом ответе есть `X-Request-Id`, а при включённом лимите — `X-RateLimit-Limit` и `X-RateLimit-Remaining`.

Старый адрес `/api/generate-window-pdf` (без `v1`) работает так же, чтобы уже написанный бот не сломался. Новым ботам — `/api/v1/…`.

**Документация для разработчика бота — `GET /docs`** (Swagger UI): все адреса, поля и коды ошибок, кнопка **Authorize** для ключа и **Try it out**, чтобы отправить пример и скачать PDF прямо со страницы. Файлы Swagger UI отдаёт сам сервер, без чужих CDN. Машиночитаемое описание — `GET /openapi.json` (OpenAPI 3.1), по нему можно сгенерировать клиент.

`GET /health` → `{"ok":true}`. Это проверка, что сервер жив; ключ не нужен.

### cURL

```bash
curl -X POST http://localhost:3000/api/v1/generate-window-pdf \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $GEOROMB_API_KEY" \
  --data-binary @server/examples/project.json \
  -o window.pdf
```

Минимальный запрос: окно 1500×1200, слева поворотно-откидная створка, справа глухое стекло.

```bash
curl -X POST http://localhost:3000/api/v1/generate-window-pdf \
  -H "Content-Type: application/json" \
  -d '{"name":"Клиент +998901234567","elements":[{"width":1500,"height":1200,"root":{"kind":"branch","dir":"v","children":[{"kind":"leaf","opening":{"type":"TiltTurn","hinge":"left"}},{"kind":"leaf"}]}}]}' \
  -o window.pdf
```

### Node.js (бот)

```js
const res = await fetch('http://localhost:3000/api/v1/generate-window-pdf', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.GEOROMB_API_KEY },
  body: JSON.stringify(project)
});
if (!res.ok) {
  const { error, message } = await res.json();     // ошибка всегда JSON
  throw new Error(`${res.status} ${error}: ${message}`);
}
const pdf = Buffer.from(await res.arrayBuffer());  // → отправить клиенту как документ
```

### Python (бот)

```python
import os, requests
r = requests.post("http://localhost:3000/api/v1/generate-window-pdf", json=project, timeout=60,
                  headers={"X-API-Key": os.environ["GEOROMB_API_KEY"]})
if r.status_code != 200:
    raise RuntimeError(f"{r.status_code} {r.json()['error']}: {r.json()['message']}")
open("window.pdf", "wb").write(r.content)
```

## Формат проекта

Формат тот же, что у резервной копии приложения GeoRomb. Служебные поля (`id`, `nid`, `history`, `date`) можно не присылать.

```jsonc
{
  "name": "Иванов, ул. Навои 12",   // шапка PDF и имя файла; по умолчанию «Проект»
  "type": "pvc",                     // pvc | alu — система профиля; по умолчанию pvc
  "phone": "+998 90 123 45 67",      // необязательно; также address, description
  "elements": [                      // 1…50 окон и дверей, у каждого своя страница
    {
      "type": "casement",            // casement (створчатое) | sliding (раздвижное) | sill (подоконник)
      "width": 1500, "height": 1200, // мм, от 100 до 10000
      "qty": 2,                      // штук, по умолчанию 1
      "net": true,                   // москитная сетка
      "root": { ... }                // деления; если не прислать, будет одно глухое стекло
    }
  ]
}
```

**Деления (`root`)** — это дерево. Узел бывает двух видов:

- **Ветка**: `{"kind":"branch", "dir":"v", "children":[...], "sizes":[700, 800]}`. Окно делится импостами на части.
  - `dir`: `v` — части стоят рядом, слева направо; `h` — друг над другом, сверху вниз.
  - `children`: минимум 2 части.
  - `sizes`: ширина (или высота) частей в мм; можно не указывать, тогда части будут поровну.
- **Лист**: `{"kind":"leaf", "fill":"glass", "opening":{"type":"Turn","hinge":"left"}}`. Это одна часть.
  - `fill`: `glass` (стекло, по умолчанию), `panelV` или `panelH` (панель).
  - `opening`: `null` значит глухая часть.
    - `type`: `Turn` (поворотная), `TiltTurn` (поворотно-откидная), `Tilt` (откидная), `Door` (дверь), `Sliding` / `FixSliding` (раздвижная / неподвижная у раздвижных).
    - `hinge`: сторона петель — `left`, `right`, `top`, `bottom`.
  - `inner`: деление внутри створки, например у двери стекло сверху и панель снизу (см. второй элемент в [examples/project.json](../server/examples/project.json)).

Если `kind` не указан, он определяется так: есть `children` — ветка, иначе лист.

## Ошибки

Ответ с ошибкой всегда JSON: `{"error": "<код>", "message": "<что не так, по-русски>", "requestId": "<номер запроса>"}`.

| HTTP | `error` | Когда |
|---|---|---|
| 400 | `invalid_json` | тело не разбирается как JSON |
| 400 | `invalid_project` | JSON разбирается, но проект плохой: нет `elements`, размер вне диапазона, неизвестный тип открывания, части не помещаются. В `message` указан номер элемента |
| 400 | `invalid_format` | `?format=` не `pdf` и не `json` |
| 400 | `invalid_lang` | `?lang=` не `ru`, `uz` и не `ky` |
| 401 | `unauthorized` | нет ключа или он неверный (если на сервере задан `API_KEYS`) |
| 429 | `rate_limited` | превышен лимит запросов в минуту; заголовок `Retry-After` — через сколько секунд повторить |
| 404 | `not_found` | другой адрес |
| 405 | `method_not_allowed` | не POST |
| 400 | `bad_request` | некорректный адрес запроса |
| 413 | `payload_too_large` | тело больше 1 МБ |
| 503 | `server_busy` | сервер уже рисует много PDF — повторите через несколько секунд |
| 500 | `pdf_generation_failed` | сбой при рисовании PDF; подробности в логе сервера |
| 500 | `internal_error` | непредвиденная ошибка сервера |

## Устройство

- [src/app.ts](../server/src/app.ts) — HTTP: маршруты, чтение тела, коды ошибок.
- [src/project.ts](../server/src/project.ts) — проверка JSON → `Project` из `app/src/types.ts`.
- [src/worker.ts](../server/src/worker.ts) — отрисовка в отдельном потоке с лимитом 60 с, чтобы сервер отвечал, пока рисуется PDF. Не больше 2 отрисовок одновременно и очередь из 8 задаются в `createApp` ([src/app.ts](../server/src/app.ts)).
- [src/pdf.ts](../server/src/pdf.ts) — `drawWindowAndMakePdf(project)`: проект → байты PDF. Если понадобится другая отрисовка, заменяется только эта функция.
- [src/page.ts](../server/src/page.ts) — страница элемента в SVG. Чертёж берётся из `app/src/render`, раскладка из `app/src/model`.
- [src/layoutJson.ts](../server/src/layoutJson.ts) — ответ для `?format=json`.

Цен и сметы в PDF нет: цены хранятся в приложении на телефоне.
