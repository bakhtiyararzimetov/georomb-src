// Мост к нативным плагинам Capacitor (Device, Filesystem, Share, App). Глобальный window.Capacitor внедряет
// нативная оболочка; в обычном браузере его нет — тогда работают браузерные запасные пути.

interface CapPlugins {
  Device?: { getId(): Promise<{ identifier: string }> };
  Filesystem?: {
    writeFile(o: { path: string; data: string; directory: string; encoding?: string; recursive?: boolean }): Promise<{ uri: string }>;
    readdir(o: { path: string; directory: string }): Promise<{ files: ({ name: string } | string)[] }>;
    deleteFile(o: { path: string; directory: string }): Promise<void>;
    checkPermissions(): Promise<{ publicStorage: string }>;
    requestPermissions(): Promise<{ publicStorage: string }>;
  };
  // встроен в Capacitor: запрос из нативного кода, поэтому видны все заголовки ответа (в WebView Date скрыт CORS)
  CapacitorHttp?: {
    get(o: { url: string; headers?: Record<string, string>; connectTimeout?: number; readTimeout?: number }): Promise<{ status: number; headers: Record<string, string>; data: unknown }>;
  };
  // свой плагин (android/.../FolderAccessPlugin.java): папка, выбранная пользователем через системный диалог
  FolderAccess?: import('../features/autoBackup.ts').FolderApi;
  Share?: { share(o: { title?: string; text?: string; url?: string; files?: string[]; dialogTitle?: string }): Promise<unknown> };
  App?: {
    minimizeApp?(): Promise<void>;
    exitApp?(): Promise<void>;
    addListener(ev: 'backButton' | 'pause', cb: () => void): unknown;
  };
}
interface CapacitorGlobal { isNativePlatform?(): boolean; Plugins?: CapPlugins; }

declare global {
  interface Window { Capacitor?: CapacitorGlobal; }
}

/** Плагины, только если приложение запущено нативно. */
export function nativePlugins(): CapPlugins | null {
  const cap = window.Capacitor;
  if(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && cap.Plugins) return cap.Plugins;
  return null;
}
