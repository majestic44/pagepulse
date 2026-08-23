import {
  listManagedMembers,
  reactivateMember,
  removeMember,
  suspendMember,
  type ManagedMember,
  type MemberPool,
  withMemberTransaction,
} from '@pagepulse/db';

export type MemberService = Readonly<{
  list: () => Promise<ReadonlyArray<ManagedMember>>;
  reactivate: (memberId: string) => Promise<void>;
  remove: (memberId: string) => Promise<void>;
  suspend: (memberId: string) => Promise<void>;
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

    async reactivate(memberId) {
      await withMemberTransaction(pool, (connection) => reactivateMember(connection, memberId));
    },

    async remove(memberId) {
      await withMemberTransaction(pool, (connection) => removeMember(connection, memberId, now()));
    },

    async suspend(memberId) {
      await withMemberTransaction(pool, (connection) => suspendMember(connection, memberId, now()));
    },
  };
}
