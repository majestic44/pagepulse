import { loadEnvironment } from '@pagepulse/config';
import { buildApp } from './app.js';
const env = loadEnvironment();
const app = await buildApp();
await app.listen({ host: '0.0.0.0', port: env.PORT });
