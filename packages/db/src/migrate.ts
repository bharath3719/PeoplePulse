import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadRootEnv } from './env';

/**
 * Applies the schema migration AND the RLS policies, in that order, in one run.
 *
 * They are deliberately not separable. A schema without its policies is a
 * schema with NO TENANT ISOLATION — every table readable by every company. If
 * these were two commands, someone would one day run only the first, and
 * nothing would appear to be wrong.
 */
export async function runMigrations(
  connectionString: string,
  appRolePassword: string,
): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const db = drizzle(pool);

  try {
    const migrationsFolder = join(import.meta.dirname, '../migrations');
    await migrate(db, { migrationsFolder });
    console.log('✓ schema migrations applied');

    const policies = readFileSync(join(import.meta.dirname, 'rls/policies.sql'), 'utf8');
    await db.execute(sql.raw(policies));
    console.log('✓ RLS policies applied');

    // The unprivileged role the APP connects as. Migrations run as the owner;
    // the application must not, or RLS is silently bypassed. See app-role.sql.
    await db.execute(sql`select set_config('app.bootstrap_password', ${appRolePassword}, false)`);
    const appRole = readFileSync(join(import.meta.dirname, 'rls/app-role.sql'), 'utf8');
    await db.execute(sql.raw(appRole));
    console.log('✓ peoplepulse_app role created (NOSUPERUSER, NOBYPASSRLS)');

    await assertRlsIsOn(db);
  } finally {
    await pool.end();
  }
}

/**
 * Verify RLS is actually ON for every tenant-owned table, and FORCEd.
 *
 * Plain ENABLE does not apply to the table owner — and the app very often
 * connects as the owner. Without FORCE, RLS is decorative. This check runs on
 * every migration so the failure is loud at deploy time rather than silent in
 * production.
 */
async function assertRlsIsOn(db: ReturnType<typeof drizzle>): Promise<void> {
  const result = await db.execute<{ tablename: string; rls: boolean; forced: boolean }>(sql`
    select c.relname as tablename,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'role','role_permission','user_role',
        'location','department','designation','grade',
        'employee','employee_event','audit_log'
      )
  `);

  const broken = result.rows.filter((r) => !r.rls || !r.forced);
  if (broken.length > 0) {
    throw new Error(
      `RLS is not enforced on: ${broken.map((b) => b.tablename).join(', ')}. ` +
      'Tenant isolation (NFR-07) is NOT in effect. Refusing to proceed.',
    );
  }

  console.log(`✓ RLS enforced on ${result.rows.length} tenant-owned tables`);
}

const isMain = process.argv[1]?.endsWith('migrate.ts');
if (isMain) {
  // npm runs this with cwd=packages/db, so the repo-root .env is two levels up
  // and nothing else here loads it (the API gets it from Nest's ConfigModule).
  loadRootEnv();

  // MIGRATION_DATABASE_URL connects as the OWNER (postgres) — it needs DDL.
  // DATABASE_URL connects as peoplepulse_app, which does not and must not.
  const url = process.env['MIGRATION_DATABASE_URL'];
  const appPassword = process.env['APP_DB_PASSWORD'];

  if (!url || !appPassword) {
    console.error('MIGRATION_DATABASE_URL and APP_DB_PASSWORD must be set. See .env.example.');
    process.exit(1);
  }

  runMigrations(url, appPassword)
    .then(() => { console.log('\nMigration complete.'); process.exit(0); })
    .catch((err: unknown) => { console.error('\nMigration failed:', err); process.exit(1); });
}
