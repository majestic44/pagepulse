import { probeRedis } from './index.js';
import { isExpectedWorkerProcessRunning } from './worker-health.js';

try {
  const expectedEntrypoint = process.argv[2];
  if (!expectedEntrypoint) {
    throw new Error('Expected worker entrypoint is required for worker health checks');
  }
  if (!isExpectedWorkerProcessRunning(expectedEntrypoint)) {
    throw new Error('Expected worker process is not running');
  }
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for worker health checks');
  }
  await probeRedis(redisUrl);
} catch {
  process.exitCode = 1;
}
