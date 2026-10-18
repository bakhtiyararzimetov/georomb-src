# Разработка и сборка

## Требования

- Node.js 26 или новее (версия в [.nvmrc](../.nvmrc)): `.ts` запускается напрямую, без сборки.
- Для APK: Android Studio / Android SDK, JDK 21 и Capacitor-проект `~/myapp` (`appId: app.georomb`).

## Команды

| Команда | Что делает |
|---|---|
| `npm install` | установить зависимости |
| `npm run dev` | приложение в браузере с перезагрузкой: http://localhost:5173 |
| `npm run typecheck` | проверка типов: `app`, `backend`, `server` |
| `npm run build` | проверка типов и сборка приложения в `app/dist` |
| `npm run preview` | открыть собранное `app/dist` |
| `npm test` | тесты сервера API |
| `npm run server` | запустить API (порт из `.env` или `PORT`, по умолчанию 3000) |
| `npm run cap:copy` | скопировать `app/dist` в `www` Capacitor-проекта |
| `npm run license -- <команда>` | CLI лицензий, см. [licensing.md](licensing.md) |

## Выпуск новой версии APK

1. Поднимите версию:
   - `APP_VERSION` в [app/src/features/about.ts](../app/src/features/about.ts) — её видно в «О приложении»;
   - `versionCode` (+1) и `versionName` в `~/myapp/android/app/build.gradle`;
   - `version` в [package.json](../package.json).
2. Соберите и перенесите сборку:
   ```bash
   npm run build
   npm run cap:copy            # старая www сохраняется как www.bak-<дата>
   cd ~/myapp && npx cap sync android
   ```
3. Соберите подписанный APK в Android Studio (Build → Generate Signed App Bundle / APK). Используйте ключ `~/myapp/georomb-release.jks`. **Без этого ключа обновление не установится поверх старой версии** — храните его в резервной копии.
4. Опубликуйте APK в репозитории страницы скачивания `bakhtiyararzimetov/GeoRomb-app` (`~/georomb-app-dl`).
5. Запишите изменения в [CHANGELOG.md](../CHANGELOG.md) и поставьте git-тег `v<версия>`.

Ключи `localStorage`, адрес `revoked.json` и открытый ключ при обновлении не меняются. Поэтому проекты, цены, склад и активация у пользователей сохраняются.

## Нативный проект ~/myapp

`~/myapp` не под git, поэтому его настройки записаны здесь.
- Плагины: `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/share`, `@capacitor/device` (ID устройства из ANDROID_ID).
- `AndroidManifest.xml`:
  - `android:requestLegacyExternalStorage="true"` у `<application>`;
  - `READ_EXTERNAL_STORAGE` и `WRITE_EXTERNAL_STORAGE` с `android:maxSdkVersion="29"`.

  Это нужно для автокопии в «Документы» на Android 10 и ниже. На Android 11+ разрешение не требуется.
- После установки плагина: `cd ~/myapp && npx cap sync android`.

## Удаление и переустановка

- **ID устройства** на Android 8+ равен ANDROID_ID приложения. Он один для пары «ключ подписи + устройство», поэтому после переустановки APK, подписанного тем же `georomb-release.jks`, ID прежний. Меняется ID после сброса телефона или при установке APK с другой подписью (например, debug).
- **Данные** восстанавливаются из `Документы/GeoRomb`: «Настройки → Импорт проектов».
  - Каждая установка пишет в свои файлы (метка в конце имени), потому что Android 11+ не даёт перезаписать файл прошлой установки.
  - Для восстановления выбирайте самый свежий файл со старой меткой.

## Совместимость данных

Новые поля в `app/src/types.ts` добавляются только необязательными. Проекты, цены и настройки со старых телефонов должны открываться без изменений, а всё новое по умолчанию выключено.

## Сервер API

```bash
cp .env.example .env    # PORT, HOST
npm run server
```

Описание запросов и ответов: [api.md](api.md).
