import { loadRootEnv } from '../../packages/db/src/env';

// Runs inside each test worker, so the DB-backed suites can see TEST_DATABASE_URL.
// Without it they would fail with "cannot reach a database" — on purpose; see
// packages/db/src/env.ts and ADR-006 for why a quiet skip is not an option.
loadRootEnv();
