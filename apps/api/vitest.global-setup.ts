import { loadRootEnv } from '../../packages/db/src/env';
import { runMigrations } from '../../packages/db/src/migrate';

/**
 * Migrate the TEST database once, before any API suite runs.
 *
 * This lives outside src/ for two reasons. `runMigrations` uses import.meta,
 * which the API's CommonJS build cannot compile. And the API must never be able
 * to run a migration: it connects as peoplepulse_app, which holds no DDL rights
 * (ADR-006). Only this harness, connecting as the owner, can.
 *
 * With no database configured this does nothing, and the DB-backed suites then
 * FAIL on their own — loudly, not as a grey "skipped" line.
 */
export default async function setup(): Promise<void> {
  loadRootEnv();
  if (process.env['SKIP_DB_TESTS'] === '1') return;

  const url = process.env['TEST_MIGRATION_DATABASE_URL'];
  const appPassword = process.env['APP_DB_PASSWORD'];
  if (!url || !appPassword) return;

  await runMigrations(url, appPassword);
}
