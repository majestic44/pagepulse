import { and, asc, eq, isNull, lte } from 'drizzle-orm';

import { type Database } from './client.js';
import { outboxEvents } from './schema.js';

const identifierPattern = /^[A-Za-z0-9_-]+$/;
const subjectTypePattern = /^[a-z][a-z0-9_-]*$/;

export const OutboxEventTypes = Object.freeze({
  notification: 'notification',
});

export type OutboxEventType = (typeof OutboxEventTypes)[keyof typeof OutboxEventTypes];

export type NewOutboxEvent = Readonly<{
  correlationId: string;
  eventType: OutboxEventType;
  id: string;
  subjectId: string;
  subjectType: string;
}>;

export type PendingOutboxEvent = Readonly<{
  correlationId: string;
  eventType: OutboxEventType;
  id: string;
}>;

export type OutboxValidationIssue = Readonly<{
  message: string;
  path: string;
}>;

export class OutboxEventValidationError extends Error {
  readonly issues: ReadonlyArray<OutboxValidationIssue>;

  constructor(issues: ReadonlyArray<OutboxValidationIssue>) {
    super(
      `Invalid outbox event: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'OutboxEventValidationError';
    this.issues = issues;
  }
}

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DatabaseSession = Database | DatabaseTransaction;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validateIdentifier(
  value: unknown,
  path: string,
  issues: OutboxValidationIssue[],
  maxLength = 128,
) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    issues.push({ message: `must be a non-empty string of at most ${maxLength} characters`, path });
    return;
  }
  if (!identifierPattern.test(value)) {
    issues.push({ message: 'must contain only letters, digits, underscores, or hyphens', path });
  }
}

export function parseNewOutboxEvent(value: unknown): NewOutboxEvent {
  const input = asRecord(value);
  if (!input) {
    throw new OutboxEventValidationError([{ message: 'must be an object', path: 'event' }]);
  }

  const issues: OutboxValidationIssue[] = [];
  const expectedProperties = new Set([
    'correlationId',
    'eventType',
    'id',
    'subjectId',
    'subjectType',
  ]);
  for (const property of Object.keys(input)) {
    if (!expectedProperties.has(property)) {
      issues.push({ message: 'is not allowed', path: property });
    }
  }

  validateIdentifier(input.id, 'id', issues);
  validateIdentifier(input.correlationId, 'correlationId', issues);
  validateIdentifier(input.subjectId, 'subjectId', issues);
  if (
    typeof input.subjectType !== 'string' ||
    input.subjectType.length === 0 ||
    input.subjectType.length > 64 ||
    !subjectTypePattern.test(input.subjectType)
  ) {
    issues.push({
      message: 'must be a lowercase identifier of at most 64 characters',
      path: 'subjectType',
    });
  }
  if (input.eventType !== OutboxEventTypes.notification) {
    issues.push({ message: 'must be a supported event type', path: 'eventType' });
  }
  if (issues.length > 0) {
    throw new OutboxEventValidationError(issues);
  }

  return {
    correlationId: input.correlationId as string,
    eventType: input.eventType as OutboxEventType,
    id: input.id as string,
    subjectId: input.subjectId as string,
    subjectType: input.subjectType as string,
  };
}

export async function appendOutboxEvent(session: DatabaseSession, value: unknown) {
  const event = parseNewOutboxEvent(value);
  await session.insert(outboxEvents).values(event);
  return event;
}

export async function withOutboxTransaction<T>(
  database: Database,
  operation: (
    context: Readonly<{
      appendOutboxEvent: (event: unknown) => Promise<NewOutboxEvent>;
      transaction: DatabaseTransaction;
    }>,
  ) => Promise<T>,
) {
  return database.transaction(async (transaction) =>
    operation({
      appendOutboxEvent: (event) => appendOutboxEvent(transaction, event),
      transaction,
    }),
  );
}

export async function listPendingOutboxEvents(
  database: Database,
  limit = 100,
  now = new Date(),
): Promise<PendingOutboxEvent[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new OutboxEventValidationError([
      { message: 'must be an integer between 1 and 1000', path: 'limit' },
    ]);
  }
  return database
    .select({
      correlationId: outboxEvents.correlationId,
      eventType: outboxEvents.eventType,
      id: outboxEvents.id,
    })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.eventType, OutboxEventTypes.notification),
        isNull(outboxEvents.publishedAt),
        lte(outboxEvents.availableAt, now),
      ),
    )
    .orderBy(asc(outboxEvents.createdAt))
    .limit(limit) as Promise<PendingOutboxEvent[]>;
}

export async function markOutboxEventPublished(
  database: Database,
  eventId: string,
  publishedAt = new Date(),
) {
  const issues: OutboxValidationIssue[] = [];
  validateIdentifier(eventId, 'id', issues);
  if (issues.length > 0) {
    throw new OutboxEventValidationError(issues);
  }
  return database
    .update(outboxEvents)
    .set({ publishedAt })
    .where(and(eq(outboxEvents.id, eventId), isNull(outboxEvents.publishedAt)));
}
