import { loadRootEnv } from './src/env';

// Runs before every test file, inside the worker, so the isolation suite can see
// TEST_DATABASE_URL. Without it the suite skips and the build goes green having
// verified nothing — see src/env.ts and ADR-006.
loadRootEnv();
