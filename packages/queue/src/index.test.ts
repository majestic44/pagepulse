import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { QueueNames, type QueuePayloadByName } from '@pagepulse/contracts';

import {
  closeQueueResources,
  createGracefulShutdown,
  enqueueJob,
  parseQueuePayload,
  type QueueForName,
  QueuePayloadValidationError,
  validateClaimedJob,
} from './index.js';

const pageFetchPayload: QueuePayloadByName[typeof QueueNames.pageFetch] = {
  version: 1,
  monitorId: 'monitor-1',
  monitorRevision: 1,
  checkId: 'check-1',
  correlationId: 'correlation-1',
};

describe('queue payload validation', () => {
  it('accepts a known versioned payload', () => {
    expect(parseQueuePayload(QueueNames.pageFetch, pageFetchPayload)).toEqual(pageFetchPayload);
  });

  it('rejects payload values outside the versioned schema without exposing their values', () => {
    let error: QueuePayloadValidationError | undefined;
    try {
      parseQueuePayload(QueueNames.pageFetch, {
        ...pageFetchPayload,
        credential: 'never-log-this',
      });
    } catch (candidate) {
      if (candidate instanceof QueuePayloadValidationError) {
        error = candidate;
      }
    }

    expect(error).toBeInstanceOf(QueuePayloadValidationError);
    expect(error?.message).toContain(QueueNames.pageFetch);
    expect(error?.message).not.toContain('never-log-this');
    expect(error?.issues).toHaveLength(1);
  });

  it('validates payloads before adding them to BullMQ', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' });
    const queue = { add } as unknown as QueueForName<typeof QueueNames.pageFetch>;

    await enqueueJob(QueueNames.pageFetch, queue, pageFetchPayload);

    expect(add).toHaveBeenCalledWith(QueueNames.pageFetch, pageFetchPayload, undefined);
  });

  it('validates a payload after a worker claims it', () => {
    const job = {
      data: { ...pageFetchPayload, cookie: 'must-not-be-queued' },
    } as unknown as Job<QueuePayloadByName[typeof QueueNames.pageFetch], unknown>;

    expect(() => validateClaimedJob(QueueNames.pageFetch, job)).toThrow(
      QueuePayloadValidationError,
    );
  });
});

describe('queue shutdown', () => {
  it('closes workers before quitting Redis', async () => {
    const events: string[] = [];
    const connection = {
      quit: vi.fn(() => {
        events.push('redis');
        return Promise.resolve('OK');
      }),
    };
    const resources = [
      {
        close: vi.fn(() => {
          events.push('worker:one');
          return Promise.resolve();
        }),
      },
      {
        close: vi.fn(() => {
          events.push('worker:two');
          return Promise.resolve();
        }),
      },
    ];

    await closeQueueResources(connection, resources);

    expect(events).toEqual(['worker:one', 'worker:two', 'redis']);
  });

  it('quits Redis even if worker shutdown fails', async () => {
    const connection = { quit: vi.fn().mockResolvedValue('OK') };
    const resources = [{ close: vi.fn().mockRejectedValue(new Error('worker close failed')) }];

    await expect(closeQueueResources(connection, resources)).rejects.toThrow('worker close failed');

    expect(connection.quit).toHaveBeenCalledOnce();
  });

  it('runs shutdown once when multiple signals arrive', async () => {
    const connection = { quit: vi.fn().mockResolvedValue('OK') };
    const close = vi.fn().mockResolvedValue(undefined);
    const shutdown = createGracefulShutdown({ connection, resources: [{ close }] });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(close).toHaveBeenCalledOnce();
    expect(connection.quit).toHaveBeenCalledOnce();
  });
});
