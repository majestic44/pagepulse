import {
  listAuditEvents,
  type AuditEvent,
  type AuditPool,
  withAuditTransaction,
} from '@pagepulse/db';

export type AuditService = Readonly<{
  list: () => Promise<ReadonlyArray<AuditEvent>>;
}>;

export type AuditServiceOptions = Readonly<{
  pool: AuditPool;
}>;

export function createAuditService({ pool }: AuditServiceOptions): AuditService {
  return {
    list: () => withAuditTransaction(pool, (connection) => listAuditEvents(connection)),
  };
}
