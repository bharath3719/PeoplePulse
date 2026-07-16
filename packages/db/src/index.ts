export * from './schema/index';
export * from './client';
export * from './rls/assert-enforced';

// NOTE: `runMigrations` is deliberately NOT exported here.
//
// It is a dev/CI tool, run through tsx, and it uses `import.meta` — which does
// not exist in the CommonJS build that the API consumes. More to the point, the
// API must never be able to run a migration: it connects as `peoplepulse_app`,
// which holds no DDL privileges at all (ADR-006). Import it directly from
// '@peoplepulse/db/src/migrate' in scripts and tests.
