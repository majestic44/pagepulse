import { createLogger, loadEnvironment } from '@pagepulse/config';
const env = loadEnvironment();
const role = env.WORKER_ROLE;
const log = createLogger(`control-worker:${role}`, env.LOG_LEVEL);
log.info({ role }, 'placeholder control worker started');
const timer = setInterval(() => log.debug({ role }, 'control worker heartbeat'), 30_000);
function shutdown(signal: string) {
  log.info({ signal, role }, 'shutting down');
  clearInterval(timer);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
