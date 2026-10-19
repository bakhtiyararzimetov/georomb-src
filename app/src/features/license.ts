// Активация по коду (привязка к устройству). Экран блокирует приложение, пока нет действующего кода
// или ID нет в подписанном списке revoked.json. Ключи хранения прежние — активированные устройства не слетят.
import {
  ID_ALPHABET, OFFLINE_DAYS, REVOKE_URL, clockAfterCheck, clockAfterOnline, clockAfterRun, clockVerdict, codeFromBackup, dateNum, formatId,
  offlineDaysLeft, parseHttpDate, pickDeviceId, verifyCode, verifyRevokedFile, type ClockState, type RevokedList, type VerifyFail
} from '../../../shared/license.ts';
import { $, copyText, showToast } from '../ui/dom.ts';
import { nativePlugins } from '../platform/capacitor.ts';
import { CONTACT } from './about.ts';

const ID_KEY = 'iwd.deviceId.v1', LIC_KEY = 'iwd.license.v1', REV_KEY = 'iwd.revoked.v2', CLOCK_KEY = 'iwd.clock.v1';
const WHY: Record<VerifyFail | 'revoked' | 'clock' | 'offline', string> = {
  format:'Код набран неверно — вставьте его целиком.',
  sig:'Код недействителен.',
  device:'Этот код выдан для другого устройства.',
  expired:'Срок лицензии истёк. Запросите новый код.',
  nocrypto:'Проверка кода недоступна в этой среде.',
  revoked:'Лицензия отозвана. Обратитесь к разработчику.',
  clock:'Дата на телефоне раньше настоящей. Включите «Дата и время сети» в настройках телефона, подключитесь к интернету и нажмите «Проверить».',
  offline:'Раз в ' + OFFLINE_DAYS + ' дней лицензию нужно проверить через интернет. Подключитесь к интернету и нажмите «Проверить».'
};
// время сборки (vite define): часы телефона не могут показывать раньше; в тестах и без сборки — 0
declare const __BUILD_TS__: number | undefined;
const BUILD_TS = typeof __BUILD_TS__ === 'number' ? __BUILD_TS__ : 0;

declare global { interface Window { licenseInfo?: { id: string; exp: string }; } }

function randomId(): string {
  const r = new Uint8Array(10);
  crypto.getRandomValues(r);
  return Array.from(r, x => ID_ALPHABET[x % ID_ALPHABET.length]).join('');
}
// ANDROID_ID через @capacitor/device; нет плагина, ошибка или ответа дольше 2 с — null (тогда случайный ID)
async function hardwareId(): Promise<string | null> {
  const dev = nativePlugins()?.Device;
  if(!dev) return null;
  try{
    const r = await Promise.race([dev.getId(), new Promise<null>(res => setTimeout(() => res(null), 2000))]);
    return r && typeof r.identifier === 'string' ? r.identifier : null;
  }catch{ return null; }
}
// сохранённый ID не меняется (обновление не сбрасывает активацию); новая установка — ID из ANDROID_ID,
// он тот же после удаления и повторной установки APK с той же подписью
async function resolveDeviceId(): Promise<string> {
  let stored: string | null = null;
  try{ stored = localStorage.getItem(ID_KEY); }catch{ /* нет хранилища */ }
  const id = await pickDeviceId(stored, stored ? null : await hardwareId(), randomId);
  if(id !== stored){ try{ localStorage.setItem(ID_KEY, id); }catch{ /* без сохранения */ } }
  return id;
}
let deviceId = '';
/** ID устройства (пустая строка, пока initLicense его не определил). */
export const getDeviceId = (): string => deviceId;

let revList: RevokedList = { ts:0, ids:[], lic:[] };
try{
  const r = JSON.parse(localStorage.getItem(REV_KEY) || 'null') as RevokedList | null;
  if(r && Array.isArray(r.ids) && Array.isArray(r.lic)){
    revList = { ts:Number(r.ts) || 0, ids:r.ids.map(String), lic:r.lic.map(x => ({ id:String(x.id), exp:String(x.exp) })) };
  }
}catch{ /* повреждённая копия — ждём свежую */ }
const revIsRevoked = () => revList.ids.indexOf(deviceId) >= 0;

let clock: ClockState = { seen:0, online:0 };
try{
  const c = JSON.parse(localStorage.getItem(CLOCK_KEY) || 'null') as ClockState | null;
  if(c) clock = { seen:Number(c.seen) || 0, online:Number(c.online) || 0 };
}catch{ /* повреждённая запись — отсчёт заново */ }
function saveClock(c: ClockState): void {
  clock = c;
  try{ localStorage.setItem(CLOCK_KEY, JSON.stringify(c)); }catch{ /* без сохранения */ }
}

// время работы приложения (монотонный таймер) добавляется к seen: раз в минуту и при сворачивании
let lastTick = performance.now();
function tickClock(): void {
  const t = performance.now();
  saveClock(clockAfterRun(Date.now(), t - lastTick, clock));
  lastTick = t;
}
// долгая сессия и возврат в приложение тоже проверяются, а не только запуск
function watchClock(): void {
  const check = () => {
    tickClock();
    if(isUnlocked() && clockVerdict(Date.now(), clock, 0) !== 'ok') void licCheck();
  };
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', check);
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// список и время сервера: в приложении — нативным запросом (виден заголовок Date), в браузере — fetch
async function getList(url: string): Promise<{ data: unknown; server: number | null } | null> {
  const http = nativePlugins()?.CapacitorHttp;
  if(http){
    // connectTimeout/readTimeout — на каждый этап и адрес, поэтому ещё и общий предел
    const r = await withTimeout(http.get({ url, headers:{ 'Cache-Control':'no-cache' }, connectTimeout:4000, readTimeout:4000 }), 6000);
    if(r.status < 200 || r.status >= 300) return null;
    const h = r.headers || {};
    const date = Object.keys(h).find(k => k.toLowerCase() === 'date');
    return { data:typeof r.data === 'string' ? JSON.parse(r.data) : r.data, server:parseHttpDate(date ? h[date] : null) };
  }
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 4000);
  try{
    const resp = await fetch(url, { cache:'no-store', signal:ctl.signal });
    if(!resp.ok) return null;
    return { data:await resp.json(), server:parseHttpDate(resp.headers.get('date')) };
  }finally{ clearTimeout(tm); }
}

// true — получили и приняли новый список; ошибка сети, старая копия или неверная подпись — список не меняется
async function revFetch(): Promise<boolean> {
  if(!REVOKE_URL) return false;
  try{
    const got = await getList(REVOKE_URL + (REVOKE_URL.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now());
    if(!got) return false;
    const r = await verifyRevokedFile(got.data);
    if(!r || r.ts < revList.ts) return false;
    revList = r;
    try{ localStorage.setItem(REV_KEY, JSON.stringify(r)); }catch{ /* без сохранения */ }
    saveClock(clockAfterOnline(Date.now(), got.server, clock));
    return true;
  }catch{
    return false;
  }
}
function showLock(msg: string, compact?: boolean): void {
  const lock = $('licenseLock');
  lock.classList.toggle('compact', !!compact);
  lock.style.display = 'flex';
  $('licenseMsg').className = 'license-msg';
  $('licenseMsg').textContent = msg || '';
}
const unlockListeners: (() => void)[] = [];
/** Вызывается, когда приложение разблокировано (после проверки кода или списка). */
export function onUnlock(cb: () => void): void { unlockListeners.push(cb); }
export const isUnlocked = (): boolean => $('licenseLock').style.display === 'none';
function unlock(exp: string): void {
  $('licenseLock').style.display = 'none';
  window.licenseInfo = { id:deviceId, exp };
  unlockListeners.forEach(cb => { try{ cb(); }catch{ /* слушатель не должен ломать разблокировку */ } });
}
async function licCheck(): Promise<void> {
  if(revIsRevoked()){ showLock(WHY.revoked, true); return; }
  // часы: перевод даты назад или 30 дней без проверки по сети — блок до «Проверить»
  const now = Date.now(), verdict = clockVerdict(now, clock, Math.max(BUILD_TS, revList.ts * 1000));
  if(verdict !== 'ok'){ showLock(WHY[verdict]); return; }
  saveClock(clockAfterCheck(now, clock));
  // активация без кода: ID в подписанном списке и срок не вышел
  const le = revList.lic.find(x => x.id === deviceId);
  if(le && (le.exp === '0' || dateNum() <= Number(le.exp))){ unlock(le.exp); return; }
  let code: string | null = null;
  try{ code = localStorage.getItem(LIC_KEY); }catch{ /* нет хранилища */ }
  if(!code){ showLock(le ? WHY.expired : ''); return; }
  const res = await verifyCode(code, deviceId);
  if(!res.ok){ showLock(WHY[res.why] || ''); return; }
  unlock(res.exp);
}

/** Сохранённый код активации (для резервной копии). */
export function storedLicenseCode(): string | null {
  try{ return localStorage.getItem(LIC_KEY); }catch{ return null; }
}
/** Код из импортированной копии: принимается, только если своего кода нет и этот подходит устройству. */
export async function adoptBackupCode(raw: unknown): Promise<boolean> {
  if(!deviceId) return false;
  const code = await codeFromBackup(raw, storedLicenseCode(), deviceId);
  if(!code) return false;
  try{ localStorage.setItem(LIC_KEY, code); }catch{ return false; }
  await licCheck();
  return true;
}

export function licCopyId(): void {
  void copyText(formatId(deviceId)).then(ok => { if(ok) showToast('ID скопирован'); });
}
// кнопка «Проверить»: свежий список и повторная проверка
export async function licRecheck(): Promise<void> {
  const msg = $('licenseMsg');
  msg.className = 'license-msg'; msg.textContent = 'Проверяю…';
  const got = await revFetch();
  await licCheck();
  if($('licenseLock').style.display === 'none'){ showToast('Лицензия активирована'); return; }
  if(!got) msg.textContent = 'Не удалось связаться с сервером. Проверьте интернет.' + (msg.textContent ? ' ' + msg.textContent : '');
  else if(!msg.textContent) msg.textContent = 'Ваш ID пока не добавлен в список. Сообщите его разработчику.';
}

export async function initLicense(): Promise<void> {
  deviceId = await resolveDeviceId();
  $('licenseId').textContent = formatId(deviceId);
  const contactText = 'Здравствуйте! Вот мой ID устройства: ' + formatId(deviceId) + '. Хочу активировать мобильное приложение.';
  const contactMsg = encodeURIComponent(contactText);
  ($('licenseTg') as HTMLAnchorElement).href = 'https://t.me/' + CONTACT.tg + '?text=' + contactMsg;
  ($('licenseWa') as HTMLAnchorElement).href = 'https://wa.me/' + CONTACT.wa + '?text=' + contactMsg;
  // Telegram не всегда подставляет текст из ссылки — копируем сообщение в буфер
  $('licenseTg').addEventListener('click', () => {
    void copyText(contactText).then(ok => { if(ok) showToast('Сообщение скопировано. Вставьте его в чат'); });
  });
  // сначала проверка по коду и сохранённому списку (без сети), затем свежий список;
  // если подошёл срок проверки по сети — сначала сеть (до 6 с), чтобы при интернете не показать лишнюю подсказку
  if(clockVerdict(Date.now(), clock, 0) === 'offline') await revFetch();
  await licCheck();
  if(await revFetch()) await licCheck();
  const left = offlineDaysLeft(Date.now(), clock);
  watchClock();
  if(isUnlocked() && left <= 5) showToast('Подключитесь к интернету: проверка лицензии нужна через ' + left + ' дн.');
}
