// Запуск API: npm run server (порт — PORT, по умолчанию 3000; адрес — HOST, по умолчанию 0.0.0.0).
import { API_PATH, createApp } from './app.ts';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
createApp().listen(port, host, () => {
  console.log(`GeoRomb API: http://${host}:${port}${API_PATH}`);
});
