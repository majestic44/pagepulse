import { describe, expect, it, vi } from 'vitest';

import { QueueNames } from '@pagepulse/contracts';

import {
  createDomainConcurrencyGate,
  deterministicJitterMilliseconds,
  dispatchScheduledPageFetch,
  type QueueForName,
} from './index.js';

describe('scheduled monitor dispatch', () => {
  it('uses deterministic bounded jitter and exponential retries for ID-only fetch jobs', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'fetch-job' });
    const queue = { add } as unknown as QueueForName<typeof QueueNames.pageFetch>;

    await dispatchScheduledPageFetch(
      queue,
      { correlationId: 'correlation_1', monitorId: 'monitor_1', monitorRevision: 2, version: 1 },
      'schedule-job-1',
    );

    expect(deterministicJitterMilliseconds('schedule-job-1:monitor_1:2')).toBe(
      deterministicJitterMilliseconds('schedule-job-1:monitor_1:2'),
    );
    expect(add).toHaveBeenCalledWith(
      QueueNames.pageFetch,
      expect.objectContaining({
        correlationId: 'correlation_1',
        monitorId: 'monitor_1',
        monitorRevision: 2,
      }),
      expect.objectContaining({
        attempts: 5,
        backoff: { delay: 1_000, type: 'exponential' },
        delay: deterministicJitterMilliseconds('schedule-job-1:monitor_1:2'),
      }),
    );
    expect(add.mock.calls[0]?.[1]).not.toHaveProperty('url');
  });

  it('limits concurrent work per domain without blocking another domain', async () => {
    const gate = createDomainConcurrencyGate(1);
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = gate.run('Example.test', async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
    });
    const sameDomain = gate.run('example.test', () => Promise.resolve(events.push('same:start')));
    const otherDomain = gate.run('other.test', () => Promise.resolve(events.push('other:start')));

    await Promise.resolve();
    expect(events).toEqual(['first:start', 'other:start']);
    releaseFirst?.();
    await Promise.all([first, sameDomain, otherDomain]);
    expect(events).toEqual(['first:start', 'other:start', 'first:end', 'same:start']);
  });
});
