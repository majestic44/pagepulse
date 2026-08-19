# PagePulse database migrations

Drizzle migrations in this directory are forward-only in production. Apply them with `pnpm db:migrate`, which obtains the `pagepulse_migrations` MariaDB advisory lock and records the resulting schema compatibility record.

## Rollback notes

| Migration                 | Rollback                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `0000_glorious_jean_grey` | Restore a verified backup taken before the initial bootstrap. Do not run destructive down SQL in production. |

For later destructive schema changes, use expand/migrate/contract across releases and add a restore or rollback note to this table.
