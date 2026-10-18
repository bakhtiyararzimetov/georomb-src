// Активация по коду (привязка к устройству). Экран блокирует приложение, пока нет действующего кода
// или ID нет в подписанном списке revoked.json. Ключи хранения прежние — активированные устройства не слетят.
import {
  ID_ALPHABET, ID_RE, REVOKE_URL, dateNum, formatId, verifyCode, verifyRevokedFile,
  type RevokedList, type VerifyFail
} from '../../../shared/license.ts';
import { $, copyText, showToast } from '../ui/dom.ts';
import { CONTACT } from './about.ts';

const ID_KEY = 'iwd.deviceId.v1', LIC_KEY = 'iwd.license.v1', REV_KEY = 'iwd.revoked.v2';
const WHY: Record<VerifyFail | 'revoked', string> = {
  format:'Код набран неверно — вставьте его целиком.',
  sig:'Код недействителен.',
  device:'Этот код выдан для другого устройства.',
  expired:'Срок лицензии истёк. Запросите новый код.',
  nocrypto:'Проверка кода недоступна в этой среде.',
  revoked:'Лицензия отозвана. Обратитесь к разработчику.'
};

declare global { interface Window { licenseInfo?: { id: string; exp: string }; } }

function getDeviceId(): string {
  let id: string | null = null;
  try{ id = localStorage.getItem(ID_KEY); }catch{ /* нет хранилища */ }
  if(!id || !ID_RE.test(id)){
    const r = new Uint8Array(10);
    crypto.getRandomValues(r);
    id = Array.from(r, x => ID_ALPHABET[x % ID_ALPHABET.length]).join('');
    try{ localStorage.setItem(ID_KEY, id); }catch{ /* без сохранения */ }
  }
  return id;
}
const deviceId = getDeviceId();

let revList: RevokedList = { ts:0, ids:[], lic:[] };
try{
  const r = JSON.parse(localStorage.getItem(REV_KEY) || 'null') as RevokedList | null;
  if(r && Array.isArray(r.ids) && Array.isArray(r.lic)){
    revList = { ts:Number(r.ts) || 0, ids:r.ids.map(String), lic:r.lic.map(x => ({ id:String(x.id), exp:String(x.exp) })) };
  }
}catch{ /* повреждённая копия — ждём свежую */ }
const revIsRevoked = () => revList.ids.indexOf(deviceId) >= 0;

// true — получили и приняли новый список; ошибка сети, старая копия или неверная подпись — список не меняется
async function revFetch(): Promise<boolean> {
  if(!REVOKE_URL) return false;
  try{
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 4000);
    const resp = await fetch(REVOKE_URL + (REVOKE_URL.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache:'no-store', signal:ctl.signal });
    clearTimeout(tm);
    if(!resp.ok) return false;
    const r = await verifyRevokedFile(await resp.json());
    if(!r || r.ts < revList.ts) return false;
    revList = r;
    try{ localStorage.setItem(REV_KEY, JSON.stringify(r)); }catch{ /* без сохранения */ }
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
function unlock(exp: string): void {
  $('licenseLock').style.display = 'none';
  window.licenseInfo = { id:deviceId, exp };
}
async function licCheck(): Promise<void> {
  if(revIsRevoked()){ showLock(WHY.revoked, true); return; }
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
  if(!msg.textContent) msg.textContent = got ? 'Ваш ID пока не добавлен в список. Сообщите его разработчику.' : 'Не удалось связаться с сервером. Проверьте интернет.';
}

export function initLicense(): void {
  $('licenseId').textContent = formatId(deviceId);
  const contactText = 'Здравствуйте! Вот мой ID устройства: ' + formatId(deviceId) + '. Хочу активировать мобильное приложение.';
  const contactMsg = encodeURIComponent(contactText);
  ($('licenseTg') as HTMLAnchorElement).href = 'https://t.me/' + CONTACT.tg + '?text=' + contactMsg;
  ($('licenseWa') as HTMLAnchorElement).href = 'https://wa.me/' + CONTACT.wa + '?text=' + contactMsg;
  // Telegram не всегда подставляет текст из ссылки — копируем сообщение в буфер
  $('licenseTg').addEventListener('click', () => {
    void copyText(contactText).then(ok => { if(ok) showToast('Сообщение скопировано. Вставьте его в чат'); });
  });
  // сначала проверка по коду и сохранённому списку (без сети), затем фоном свежий список
  void (async () => {
    await licCheck();
    if(await revFetch()) await licCheck();
  })();
}
