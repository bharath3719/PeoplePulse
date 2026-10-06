import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { eq, inArray } from 'drizzle-orm';
import {
  getDb, closeDb, withPurgeMode, assertRlsEnforced,
  tenant, user, userTenant, type Database,
} from '@peoplepulse/db';
import { AuthService } from './auth.service';
import type { JwtPayload } from './authed-request';

/**
 * The company switcher (D-16), against a real database.
 *
 * `user_tenant` sits outside RLS — login has to read it before any tenant is
 * known — so nothing but these queries stands between a user and a company they
 * do not belong to. Each test tries to reach one.
 *
 * Like the other DB suites, this FAILS without a database rather than skipping.
 */
const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const OPTED_OUT = process.env['SKIP_DB_TESTS'] === '1';

if (!OPTED_OUT && !TEST_DB_URL) {
  throw new Error(
    'The company-switcher suite cannot reach a database. Set TEST_DATABASE_URL ' +
      '(see .env.example), or SKIP_DB_TESTS=1 if you mean to run without one.',
  );
}

const describeIfDb = OPTED_OUT ? describe.skip : describe;

const SECRETS: Record<string, string> = {
  JWT_ACCESS_SECRET: 'test-only-access-secret',
  JWT_REFRESH_SECRET: 'test-only-refresh-secret',
};
const config = {
  getOrThrow: (key: string) => SECRETS[key],
  get: (_key: string, fallback: unknown) => fallback,
} as unknown as ConfigService;

const PASSWORD = 'correct horse battery staple';

let db: Database;
let jwt: JwtService;
let service: AuthService;

const tenants: string[] = [];
const users: string[] = [];

// The CA firm's accountant: two client companies, plus one that let them go.
let accountant: string;
let accountantEmail: string;
let acme: string;     // member
let zenith: string;   // member
let globex: string;   // membership deactivated
let initech: string;  // someone else's company entirely

async function company(name: string): Promise<string> {
  const [row] = await db.insert(tenant)
    .values({ name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID().slice(0, 8)}` })
    .returning({ id: tenant.id });
  tenants.push(row!.id);
  return row!.id;
}

async function login(email: string): Promise<string> {
  const [row] = await db.insert(user)
    .values({ email, passwordHash: await AuthService.hashPassword(PASSWORD) })
    .returning({ id: user.id });
  users.push(row!.id);
  return row!.id;
}

beforeAll(async () => {
  if (!TEST_DB_URL) return;

  db = getDb(TEST_DB_URL);
  await assertRlsEnforced(db);

  jwt = new JwtService();
  service = new AuthService(db, jwt, config);

  // Created out of name order, so a passing order assertion means sorting
  // happened rather than insertion order leaking through.
  zenith = await company('Zenith Exports');
  acme = await company('Acme Textiles');
  globex = await company('Globex Motors');
  initech = await company('Initech Software');

  accountantEmail = `ca-${randomUUID().slice(0, 8)}@example.test`;
  accountant = await login(accountantEmail);
  const someoneElse = await login(`hr-${randomUUID().slice(0, 8)}@example.test`);

  await db.insert(userTenant).values([
    { userId: accountant, tenantId: zenith },
    { userId: accountant, tenantId: acme },
    { userId: accountant, tenantId: globex, isActive: false },
    { userId: someoneElse, tenantId: initech },
  ]);
});

afterAll(async () => {
  if (!db) return;
  for (const id of tenants) {
    await withPurgeMode(db, id, 'company-switcher test teardown', (tx) =>
      tx.delete(tenant).where(eq(tenant.id, id)));
  }
  if (users.length > 0) await db.delete(user).where(inArray(user.id, users));
  await closeDb();
});

describeIfDb('the company switcher', () => {
  it('lists every active membership, by name, and no one else\'s', async () => {
    const listed = await service.listTenants(accountant);

    expect(listed.map((t) => t.id)).toEqual([acme, zenith]);
    expect(listed[0]).toMatchObject({ name: 'Acme Textiles' });
  });

  it('logs in to the first company by name when none is named', async () => {
    const result = await service.login(accountantEmail, PASSWORD);

    expect(result.activeTenant.id).toBe(acme);
    expect(result.tenants.map((t) => t.id)).toEqual([acme, zenith]);
  });

  it('re-issues the token for the company switched to', async () => {
    const result = await service.switchTenant(accountant, zenith);

    const payload = jwt.verify<JwtPayload>(result.accessToken, { secret: SECRETS['JWT_ACCESS_SECRET']! });
    expect(payload.tid).toBe(zenith);
    expect(payload.sub).toBe(accountant);
    expect(result.activeTenant.id).toBe(zenith);
  });

  it('refuses a company whose membership was deactivated', async () => {
    await expect(service.switchTenant(accountant, globex)).rejects.toThrow(ForbiddenException);
  });

  it('refuses a company the user never belonged to', async () => {
    await expect(service.switchTenant(accountant, initech)).rejects.toThrow(ForbiddenException);
    await expect(service.switchTenant(accountant, randomUUID())).rejects.toThrow(ForbiddenException);
  });
});
