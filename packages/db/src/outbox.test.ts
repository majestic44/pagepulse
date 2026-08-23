import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client.js';
import {
  appendOutboxEvent,
  OutboxEventTypes,
  OutboxEventValidationError,
  parseNewOutboxEvent,
  withOutboxTransaction,
} from './outbox.js';
import { outboxEvents } from './schema.js';

const notificationEvent = {
  correlationId: 'correlation_1',
  eventType: OutboxEventTypes.notification,
  id: 'outbox_1',
  subjectId: 'change_1',
  subjectType: 'change',
};

describe('outbox events', () => {
  it('accepts identifier-only notification events', () => {
    expect(parseNewOutboxEvent(notificationEvent)).toEqual(notificationEvent);
  });

  it('rejects unsupported fields and does not expose their values', () => {
    let error: OutboxEventValidationError | undefined;
    try {
      parseNewOutboxEvent({ ...notificationEvent, body: 'private fetched content' });
    } catch (candidate) {
      if (candidate instanceof OutboxEventValidationError) {
        error = candidate;
      }
    }

    expect(error).toBeInstanceOf(OutboxEventValidationError);
    expect(error?.message).toContain('body: is not allowed');
    expect(error?.message).not.toContain('private fetched content');
  });

  it('inserts the event through the caller transaction', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });

    await appendOutboxEvent({ insert } as unknown as Database, notificationEvent);

    expect(insert).toHaveBeenCalledWith(outboxEvents);
    expect(values).toHaveBeenCalledWith(notificationEvent);
  });

  it('keeps the event write inside the database transaction', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });
    const transaction = { insert };
    const runTransaction = async (
      operation: (currentTransaction: typeof transaction) => Promise<string>,
    ) => operation(transaction);
    const database = {
      transaction: vi.fn(runTransaction),
    } as unknown as Database;

    const result = await withOutboxTransaction(database, async ({ appendOutboxEvent }) => {
      await appendOutboxEvent(notificationEvent);
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(values).toHaveBeenCalledWith(notificationEvent);
  });
});
