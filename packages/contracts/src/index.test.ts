import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { CheckJob, QueueNames, QueuePayloadSchemas } from './index.js';

describe('queue payload contracts', () => {
  it('keeps page fetch jobs versioned and identifier-only', () => {
    expect(
      Value.Check(CheckJob, {
        version: 1,
        monitorId: 'monitor-1',
        monitorRevision: 2,
        checkId: 'check-1',
        correlationId: 'correlation-1',
      }),
    ).toBe(true);
  });

  it('rejects unknown fields such as secrets from queue payloads', () => {
    expect(
      Value.Check(QueuePayloadSchemas[QueueNames.pageFetch], {
        version: 1,
        monitorId: 'monitor-1',
        monitorRevision: 2,
        checkId: 'check-1',
        correlationId: 'correlation-1',
        credential: 'must-not-be-queued',
      }),
    ).toBe(false);
  });
});
