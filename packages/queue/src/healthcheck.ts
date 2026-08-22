import { probeRedis } from './index.js';

try {
  process.kill(1, 0);
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for worker health checks');
  }
  await probeRedis(redisUrl);
} catch {
  process.exitCode = 1;
}
