import {
  AuditActions,
  listManagedMembers,
  recordAuditEvent,
  reactivateMember,
  removeMember,
  suspendMember,
  type ManagedMember,
  type AuditContext,
  type MemberPool,
  withMemberTransaction,
} from '@pagepulse/db';

export type MemberService = Readonly<{
  list: () => Promise<ReadonlyArray<ManagedMember>>;
  reactivate: (memberId: string, audit?: MemberAuditContext) => Promise<void>;
  remove: (memberId: string, audit?: MemberAuditContext) => Promise<void>;
  suspend: (memberId: string, audit?: MemberAuditContext) => Promise<void>;
}>;

export type MemberAuditContext = AuditContext &
  Readonly<{
    actorUserId: string;
  }>;

export type MemberServiceOptions = Readonly<{
  now?: () => Date;
  pool: MemberPool;
}>;

export function createMemberService({
  now = () => new Date(),
  pool,
}: MemberServiceOptions): MemberService {
  return {
    async list() {
      return withMemberTransaction(pool, (connection) => listManagedMembers(connection));
    },

    async reactivate(memberId, audit) {
      await withMemberTransaction(pool, async (connection) => {
        await reactivateMember(connection, memberId);
        if (audit) {
          await recordAuditEvent(connection, {
            ...audit,
            action: AuditActions.memberReactivated,
            targetId: memberId,
            targetType: 'member',
          });
        }
      });
    },

    async remove(memberId, audit) {
      await withMemberTransaction(pool, async (connection) => {
        await removeMember(connection, memberId, now());
        if (audit) {
          await recordAuditEvent(connection, {
            ...audit,
            action: AuditActions.memberRemoved,
            targetId: memberId,
            targetType: 'member',
          });
        }
      });
    },

    async suspend(memberId, audit) {
      await withMemberTransaction(pool, async (connection) => {
        await suspendMember(connection, memberId, now());
        if (audit) {
          await recordAuditEvent(connection, {
            ...audit,
            action: AuditActions.memberSuspended,
            targetId: memberId,
            targetType: 'member',
          });
        }
      });
    },
  };
}
