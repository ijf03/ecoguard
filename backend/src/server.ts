import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { createLocalServices } from './local.js';
import { createCognitoAuth } from './auth.js';

if (existsSync('.env')) process.loadEnvFile('.env');
if (process.env.NODE_ENV === 'production') throw new Error('Local development server is not a production deployment. Use authorized cloud handlers.');
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const services = await createLocalServices(process.env.DATA_DIR ?? 'data');
const poolId = process.env.ECOGUARD_USER_POOL_ID;
const clientId = process.env.ECOGUARD_CLIENT_ID;
if (Boolean(poolId) !== Boolean(clientId)) throw new Error('Configure both the Cognito user-pool ID and app-client ID.');
const auth = poolId && clientId ? createCognitoAuth({ userPoolId: poolId, clientId, frontendOrigin: process.env.ECOGUARD_FRONTEND_ORIGIN ?? 'http://127.0.0.1:5173' }) : undefined;
const app = createApp({ ...services, ...(auth ? { auth } : {}), maxVideoUploadBytes: Number(process.env.ECOGUARD_MAX_VIDEO_BYTES ?? 50 * 1024 * 1024) });
app.listen(port, '127.0.0.1', () => console.log(`EcoGuard local API: http://127.0.0.1:${port}/api/health`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => app.close(() => services.close()));
app.once('error', error => { services.close(); console.error(error); process.exitCode = 1; });
