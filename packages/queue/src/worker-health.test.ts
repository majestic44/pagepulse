import { describe, expect, it } from 'vitest';
import { hasExpectedWorkerProcess } from './worker-health.js';

const workerEntrypoint = 'apps/control-worker/dist/index.js';

describe('hasExpectedWorkerProcess', () => {
  it('finds the worker node process and ignores Docker init and the healthcheck process', () => {
    const processes = [
      {
        pid: 1,
        command: ['/sbin/docker-init', '--', 'node', workerEntrypoint],
      },
      {
        pid: 7,
        command: ['node', workerEntrypoint],
      },
      {
        pid: 12,
        command: ['node', 'packages/queue/dist/healthcheck.js', workerEntrypoint],
      },
    ];

    expect(hasExpectedWorkerProcess(processes, workerEntrypoint, 12)).toBe(true);
  });

  it('does not mistake Docker init for a live worker', () => {
    const processes = [
      {
        pid: 1,
        command: ['/sbin/docker-init', '--', 'node', workerEntrypoint],
      },
      {
        pid: 12,
        command: ['node', 'packages/queue/dist/healthcheck.js', workerEntrypoint],
      },
    ];

    expect(hasExpectedWorkerProcess(processes, workerEntrypoint, 12)).toBe(false);
  });
});
