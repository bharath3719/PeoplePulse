import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

/**
 * Load the repo-root `.env` into process.env.
 *
 * The API gets this for free from Nest's ConfigModule. Nothing else did — so
 * `npm run db:migrate` could not find its credentials, and, far worse, the
 * tenant-isolation suite saw no TEST_DATABASE_URL and quietly skipped all 13 of
 * its tests while `npm test` reported green.
 *
 * A skipped isolation suite is not a smaller version of a passing one. It is the
 * same false assurance ADR-006 is about, arriving by a different route.
 *
 * We walk up rather than resolving a fixed `../../.env`, because the caller's
 * cwd differs: npm workspace scripts run in `packages/db`, a bare `vitest` run
 * may not. Values already in the real environment win — dotenv does not
 * override — so CI can inject secrets without a file.
 */
export function loadRootEnv(startDir: string = process.cwd()): string | null {
  let dir = startDir;

  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate });
      return candidate;
    }

    const parent = dirname(dir);
    if (parent === dir) return null; // hit the filesystem root
    dir = parent;
  }
}
