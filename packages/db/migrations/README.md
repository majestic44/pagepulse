# PagePulse database migrations

Drizzle migrations in this directory are forward-only in production. Apply them with `pnpm db:migrate`, which obtains the `pagepulse_migrations` MariaDB advisory lock and records the resulting schema compatibility record.

## Rollback notes

| Migration                        | Rollback                                                                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_glorious_jean_grey`        | Restore a verified backup taken before the initial bootstrap. Do not run destructive down SQL in production.                                                                                                               |
| `0001_colorful_ulik`             | Additive only. Stop the scheduler and restore a verified pre-migration backup if the new rows must be removed; do not drop the tables in production.                                                                       |
| `0002_long_sue_storm`            | Additive only. Disable owner bootstrap and restore a verified pre-migration backup if the pending owner and token must be removed; do not drop the table in production.                                                    |
| `0003_tired_thunderbolt_ross`    | Additive only. Disable authentication endpoints and restore a verified pre-migration backup if the new account state must be removed; do not drop tables or user columns in production.                                    |
| `0004_vengeful_ego`              | Additive only. Disable session endpoints and restore a verified pre-migration backup if session records must be removed; do not drop the table in production.                                                              |
| `0005_brown_microbe`             | Additive only. Disable TOTP routes and restore a verified pre-migration backup if factor records must be removed; do not drop the tables in production.                                                                    |
| `0006_account-deletion-recovery` | Additive only. Disable account-deletion routes and the maintenance sweep, then restore a verified pre-migration backup if deletion state must be removed; do not drop user columns or narrow the token enum in production. |

For later destructive schema changes, use expand/migrate/contract across releases and add a restore or rollback note to this table.
