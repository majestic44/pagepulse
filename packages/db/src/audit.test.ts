import { describe, expect, it, vi } from 'vitest';

import {
  AuditActions,
  hashAuditRequesterIp,
  listAuditEvents,
  purgeExpiredAuditEvents,
  recordAuditEvent,
} from './audit.js';

const now = new Date('2026-08-24T12:00:00.000Z');
type AuditConnection = Parameters<typeof recordAuditEvent>[0];

function connection(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as AuditConnection;
}

describe('audit event persistence', () => {
  it('stores safe identifiers and a 90-day expiry without a plaintext requester IP', async () => {
    const query = vi.fn().mockResolvedValue([[], []]);
    const requesterIp = '127.0.0.1';
    const event = await recordAuditEvent(connection(query), {
      action: AuditActions.loginSucceeded,
      actorUserId: 'owner-id',
      createdAt: now,
      requesterIpHash: hashAuditRequesterIp(requesterIp),
      requestId: 'req-1',
      targetId: 'session-id',
      targetType: 'session',
    });

    expect(event.expiresAt).toEqual(new Date('2026-11-22T12:00:00.000Z'));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_events'), [
      event.id,
      'owner-id',
      AuditActions.loginSucceeded,
      'session',
      'session-id',
      hashAuditRequesterIp(requesterIp),
      'req-1',
      event.expiresAt,
      now,
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain(requesterIp);
  });

  it('returns a bounded newest-first owner audit feed', async () => {
    const query = vi.fn().mockResolvedValue([
      [
        {
          action: AuditActions.memberSuspended,
          actorUserId: 'owner-id',
          createdAt: now,
          expiresAt: new Date('2026-11-22T12:00:00.000Z'),
          id: 'event-id',
          requesterIpHash: hashAuditRequesterIp('127.0.0.1'),
          requestId: 'req-2',
          targetId: 'member-id',
          targetType: 'member',
        },
      ],
      [],
    ]);

    await expect(listAuditEvents(connection(query), 25, now)).resolves.toEqual([
      expect.objectContaining({
        action: AuditActions.memberSuspended,
        actorUserId: 'owner-id',
        targetId: 'member-id',
        targetType: 'member',
      }),
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE expires_at > ?'), [now]);
  });

  it('removes expired events in a bounded batch', async () => {
    const query = vi.fn().mockResolvedValue([{ affectedRows: 2 }, []]);

    await expect(purgeExpiredAuditEvents(connection(query), now, 50)).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT 50'), [now]);
  });

  it('rejects malformed audit data and unsafe batch sizes', async () => {
    const query = vi.fn().mockResolvedValue([[], []]);

    await expect(
      recordAuditEvent(connection(query), {
        action: AuditActions.logout,
        requesterIpHash: 'not-a-hash',
        targetType: 'session',
      }),
    ).rejects.toThrow('requesterIpHash is invalid');
    await expect(listAuditEvents(connection(query), 1_001)).rejects.toThrow('limit is invalid');
  });
});
