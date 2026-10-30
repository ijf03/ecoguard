import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { createLocalServices } from './local.js';

if (existsSync('.env')) process.loadEnvFile('.env');
if (process.env.NODE_ENV === 'production') throw new Error('Local development server is not a production deployment. Use authorized cloud handlers.');
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const services = await createLocalServices(process.env.DATA_DIR ?? 'data');
const app = createApp(services);
app.listen(port, '127.0.0.1', () => console.log(`EcoGuard local API: http://127.0.0.1:${port}/api/health`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => app.close(() => services.close()));
app.once('error', error => { services.close(); console.error(error); process.exitCode = 1; });
