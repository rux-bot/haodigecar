import { createApp } from './app.mjs';

const port = Number(process.env.API_PORT || process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT 必须是有效端口');
const host = process.env.HOST || '127.0.0.1';
if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN) throw new Error('生产启动需设置 PUBLIC_ORIGIN，例如 https://cars.example.com');
const app = createApp();
const server = app.listen(port, host, () => console.log(`车型网站已启动：http://${host}:${port}`));
const shutdown = () => server.close(() => { app.locals.closeDatabase(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
