import { createLogger } from '@pagepulse/config';
const role = process.env.WORKER_ROLE ?? 'scheduler';
const log = createLogger(`control-worker:${role}`);
log.info({ role }, 'placeholder control worker started');
const timer = setInterval(() => log.debug({ role }, 'control worker heartbeat'), 30_000);
function shutdown(signal: string) {
  log.info({ signal, role }, 'shutting down');
  clearInterval(timer);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
