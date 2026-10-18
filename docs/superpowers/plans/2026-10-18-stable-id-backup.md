# Стабильный ID и автокопия проектов — план

> Выполняется inline (superpowers:executing-plans), TDD на каждый шаг.

**Цель:** после удаления и повторной установки APK (1) ID устройства тот же — активация из revoked.json подтягивается кнопкой «Проверить»; (2) проекты, цены, склад и код активации можно вернуть из файла `Документы/GeoRomb/…json`.

**Решения (в чате 2026-10-18, остальное — на усмотрение исполнителя):** ID — из ANDROID_ID (@capacitor/device `getId`), но уже сохранённый ID не меняется; копия — автоматически после изменений и при сворачивании, восстановление — существующим «Импорт проектов».

## Global Constraints
- Ключи localStorage `iwd.*` не меняются; формат резервной копии прежний (`window-projects-backup`, version 1), новые поля — необязательные.
- ID: формат `ID_RE` (`[A-Z2-9]{10}`), из алфавита `ID_ALPHABET`; хэш SHA-256 от `'georomb-device|' + androidId`.
- Копия: `Documents/GeoRomb/georomb-backup-YYYY-MM-DD-<метка установки>.json`, метка — 4 знака `ID_ALPHABET` в `iwd.backupTag.v1`; храним 7 последних дней своей метки, чужие файлы не трогаем.
- В браузере (не нативно) — поведение как раньше: случайный ID, без автокопии.

## Review Focus
- Обновление поверх старой версии: сохранённый случайный ID не меняется (иначе все клиенты слетят).
- Device.getId недоступен/бросает/пустой → случайный ID, приложение не зависает на экране активации.
- Нет разрешения на Android ≤ 10 / ошибка записи → приложение работает, копия молча пропускается.
- Файл с тем же именем от прошлой установки → не перезаписываем чужой (новая метка).
- Импорт копии с кодом активации другого устройства → код не сохраняется.

### Task 1: ID из ANDROID_ID — `shared/license.ts`: `deviceIdFromHardware(hw: string): Promise<string>`, `pickDeviceId(stored: string | null, hw: string | null, random: () => string): Promise<string>`; тесты `app/test/deviceId.test.ts`.
### Task 2: `features/license.ts` — ID определяется асинхронно в `initLicense` (Device.getId через мост), экран активации показывает его после определения.
### Task 3: `features/autoBackup.ts` — `backupFileName`, `filesToPrune`, `createAutoBackup({ fs, now, getJson, tag, delayMs })` с `schedule()`/`flush()`; тесты `app/test/autoBackup.test.ts` с поддельным Filesystem.
### Task 4: связка — `storage.ts` сообщает о сохранении, `App` pause → `flush`, `backup.ts` экспортирует `buildBackup` и `licenseCode`; импорт сохраняет код, только если он подходит этому устройству.
### Task 5: `~/myapp` — `@capacitor/device`, разрешения для Android ≤ 10, `requestLegacyExternalStorage`; docs/development.md, CHANGELOG.
