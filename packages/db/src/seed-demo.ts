/**
 * A living demo company, for screenshots, demos and building UI against data
 * that looks like a real customer's: `npm run db:seed` (with the API running).
 *
 *   Tungabhadra Organics Pvt Ltd — invented. 60 invented people across a
 *   Bengaluru head office, a Hosapete plant and a Pune sales office; plant
 *   shifts and night loaders; a manager tree; PF/ESI-registered with wages on
 *   both sides of the ceilings; a 2026 holiday calendar; this year's leave
 *   (some out today, some waiting on a decision); and ~3 months of punches.
 *
 * WHAT GOES THROUGH THE API, AND WHAT DOES NOT
 * Everything the API will do is done through it, so derived facts — PF status,
 * ESI coverage, accruals, audit entries — come from the real code paths:
 * signup, statutory settings, org units, shifts, employees, rosters, holidays,
 * accruals. Two things the API rightly refuses are written straight to the
 * database as the migration owner:
 *   - past punches: a punch is timed by the server (ADR-009), so history
 *     cannot be sent;
 *   - leave taken by people with no login: only the employee may apply.
 * Those rows follow the same rules the services enforce (a DEBIT per approved
 * request, days counted over working days, IN then OUT), so the ledger and the
 * attendance pages read them exactly as they would read real ones.
 *
 * Dev databases only: it refuses to run with NODE_ENV=production. Every
 * address is on .example, which cannot receive mail. Re-running with the same
 * admin address stops at signup ("already registered"); set SEED_DEMO_EMAIL
 * to make another copy.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadRootEnv } from './env';

loadRootEnv();

if (process.env['NODE_ENV'] === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}

const API = process.env['SEED_API_URL'] ?? 'http://localhost:3000/api/v1';
const OWNER_DB = process.env['MIGRATION_DATABASE_URL'];
const DOMAIN = 'tungabhadra.example';
const ADMIN_EMAIL = process.env['SEED_DEMO_EMAIL'] ?? `priya.raman@${DOMAIN}`;
const ADMIN_PASSWORD = process.env['SEED_DEMO_PASSWORD'] ?? `demo-${randomBytes(9).toString('base64url')}`;

// --- Deterministic randomness: the same seed, the same company. ---------------
let state = 0x5eed2026;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p: number) => rand() < p;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

// --- Calendar, on IST dates ("YYYY-MM-DD") ---------------------------------------
const DAY = 86_400_000;
const IST_OFFSET_MIN = 330;
const istToday = (): string => new Date(Date.now() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** The instant of `minutes` past IST midnight on IST date `d` (minutes may pass 1440). */
const istInstant = (d: string, minutes: number) => new Date(Date.parse(`${d}T00:00:00Z`) + (minutes - IST_OFFSET_MIN) * 60_000);

const TODAY = istToday();
const YEAR = Number(TODAY.slice(0, 4));
const NOW = new Date();

// --- The company ------------------------------------------------------------------
type Site = 'BLR' | 'HSP' | 'PNQ';
type ShiftCode = 'GEN' | 'PLA' | 'PLB' | 'NGT';

interface Person {
  first: string; last: string; gender: 'MALE' | 'FEMALE';
  dept: string; title: string; site: Site; shift: ShiftCode;
  /** Index in PEOPLE of their manager. */
  reportsTo?: number;
  join?: string;
  /** Monthly gross, rupees. */
  gross: number;
  /** Plant floor: no work email. */
  floor?: boolean;
}

const P = (
  first: string, last: string, gender: 'M' | 'F', dept: string, title: string, site: Site, shift: ShiftCode,
  gross: number, reportsTo?: number, join?: string, floor = false,
): Person => ({
  first, last, gender: gender === 'M' ? 'MALE' : 'FEMALE', dept, title, site, shift, gross, floor,
  ...(reportsTo !== undefined ? { reportsTo } : {}), ...(join ? { join } : {}),
});

// Indices are referenced by reportsTo; keep the order.
const PEOPLE: Person[] = [
  /* 0 */ P('Raghav', 'Hegde', 'M', 'Leadership', 'Managing Director', 'BLR', 'GEN', 300000, undefined, '2017-04-03'),
  /* 1 */ P('Shalini', 'Kulkarni', 'F', 'Leadership', 'Chief Operating Officer', 'BLR', 'GEN', 240000, 0, '2018-01-15'),
  /* 2 */ P('Priya', 'Raman', 'F', 'HR and admin', 'HR Manager', 'BLR', 'GEN', 95000, 1, '2019-07-01'),
  /* 3 */ P('Anand', 'Joshi', 'M', 'HR and admin', 'HR Executive', 'BLR', 'GEN', 38000, 2),
  /* 4 */ P('Fathima', 'Begum', 'F', 'HR and admin', 'Admin Executive', 'BLR', 'GEN', 28000, 2),
  /* 5 */ P('Sunil', 'Gowda', 'M', 'HR and admin', 'Office Assistant', 'BLR', 'GEN', 17500, 2),
  /* 6 */ P('Vikram', 'Shetty', 'M', 'Finance and accounts', 'Finance Manager', 'BLR', 'GEN', 140000, 0, '2018-09-10'),
  /* 7 */ P('Deepa', 'Nair', 'F', 'Finance and accounts', 'Senior Accountant', 'BLR', 'GEN', 62000, 6, `${YEAR - 5}-${anniversarySoon(4)}`),
  /* 8 */ P('Karthik', 'Iyer', 'M', 'Finance and accounts', 'Accountant', 'BLR', 'GEN', 42000, 6),
  /* 9 */ P('Neha', 'Agarwal', 'F', 'Finance and accounts', 'Accounts Executive', 'BLR', 'GEN', 30000, 6),
  /* 10 */ P('Mohammed', 'Irfan', 'M', 'Finance and accounts', 'Accounts Executive', 'BLR', 'GEN', 29000, 6),
  /* 11 */ P('Arjun', 'Reddy', 'M', 'Sales', 'Head of Sales', 'BLR', 'GEN', 165000, 1, '2018-06-04'),
  /* 12 */ P('Sneha', 'Patil', 'F', 'Sales', 'Key Account Manager', 'PNQ', 'GEN', 88000, 11, `${YEAR - 6}-${anniversarySoon(19)}`),
  /* 13 */ P('Rohan', 'Deshmukh', 'M', 'Sales', 'Area Sales Manager', 'PNQ', 'GEN', 76000, 11),
  /* 14 */ P('Kavya', 'Menon', 'F', 'Sales', 'Sales Executive', 'BLR', 'GEN', 36000, 11),
  /* 15 */ P('Imran', 'Khan', 'M', 'Sales', 'Sales Executive', 'BLR', 'GEN', 34000, 11),
  /* 16 */ P('Pooja', 'Bhosale', 'F', 'Sales', 'Sales Executive', 'PNQ', 'GEN', 33000, 13),
  /* 17 */ P('Siddharth', 'Rao', 'M', 'Sales', 'Sales Executive', 'BLR', 'GEN', 35000, 11),
  /* 18 */ P('Aditi', 'Jadhav', 'F', 'Sales', 'Sales Coordinator', 'PNQ', 'GEN', 27000, 13),
  /* 19 */ P('Naveen', 'Kumar', 'M', 'Sales', 'Sales Executive', 'BLR', 'GEN', 32000, 11),
  /* 20 */ P('Ritu', 'Sharma', 'F', 'Customer support', 'Customer Support Lead', 'BLR', 'GEN', 52000, 11),
  /* 21 */ P('Joseph', "D'Souza", 'M', 'Customer support', 'Customer Support Executive', 'BLR', 'GEN', 26000, 20, addDays(TODAY, -15)),
  /* 22 */ P('Manjunath', 'Patil', 'M', 'Procurement', 'Procurement Manager', 'HSP', 'GEN', 92000, 1, '2019-03-11'),
  /* 23 */ P('Lakshmi', 'Devi', 'F', 'Procurement', 'Purchase Executive', 'HSP', 'GEN', 31000, 22),
  /* 24 */ P('Basavaraj', 'Angadi', 'M', 'Procurement', 'Purchase Executive', 'HSP', 'GEN', 30000, 22),
  /* 25 */ P('Ayesha', 'Siddiqui', 'F', 'Procurement', 'Vendor Coordinator', 'HSP', 'GEN', 26000, 22),
  /* 26 */ P('Meera', 'Krishnan', 'F', 'Quality', 'Quality Manager', 'HSP', 'GEN', 98000, 1, '2019-10-07'),
  /* 27 */ P('Prakash', 'Naik', 'M', 'Quality', 'QC Chemist', 'HSP', 'PLA', 34000, 26, `${YEAR - 3}-${anniversarySoon(8)}`),
  /* 28 */ P('Shruti', 'Kamath', 'F', 'Quality', 'QC Analyst', 'HSP', 'PLA', 27000, 26),
  /* 29 */ P('Ganesh', 'Bhat', 'M', 'Quality', 'QC Analyst', 'HSP', 'PLB', 26500, 26),
  /* 30 */ P('Rekha', 'Hiremath', 'F', 'Quality', 'Lab Assistant', 'HSP', 'PLA', 18500, 26),
  /* 31 */ P('Ramesh', 'Babu', 'M', 'Maintenance', 'Maintenance Engineer', 'HSP', 'PLA', 48000, 42),
  /* 32 */ P('Santosh', 'Kumbar', 'M', 'Maintenance', 'Electrician', 'HSP', 'PLA', 21000, 31, undefined, true),
  /* 33 */ P('Venkatesh', 'Murthy', 'M', 'Maintenance', 'Fitter', 'HSP', 'PLB', 20000, 31, undefined, true),
  /* 34 */ P('Harish', 'Poojary', 'M', 'Maintenance', 'Technician', 'HSP', 'PLB', 19500, 31, undefined, true),
  /* 35 */ P('Mahesh', 'Yadav', 'M', 'Warehouse and logistics', 'Warehouse Manager', 'HSP', 'GEN', 72000, 1, `${YEAR - 7}-${anniversarySoon(25)}`),
  /* 36 */ P('Ravi', 'Teja', 'M', 'Warehouse and logistics', 'Store Keeper', 'HSP', 'GEN', 24000, 35),
  /* 37 */ P('Abdul', 'Rahman', 'M', 'Warehouse and logistics', 'Forklift Operator', 'HSP', 'NGT', 19000, 35, undefined, true),
  /* 38 */ P('Shivakumar', 'Hosamani', 'M', 'Warehouse and logistics', 'Loader', 'HSP', 'NGT', 15500, 35, undefined, true),
  /* 39 */ P('Girish', 'Kori', 'M', 'Warehouse and logistics', 'Dispatch Executive', 'HSP', 'GEN', 25000, 35),
  /* 40 */ P('Nagaraj', 'Talwar', 'M', 'Warehouse and logistics', 'Loader', 'HSP', 'NGT', 15500, 35, undefined, true),
  /* 41 */ P('Sunitha', 'Rao', 'F', 'Warehouse and logistics', 'Logistics Coordinator', 'HSP', 'GEN', 29000, 35),
  /* 42 */ P('Suresh', 'Patil', 'M', 'Production', 'Production Manager', 'HSP', 'GEN', 110000, 1, '2018-11-19'),
  /* 43 */ P('Anitha', 'Gowda', 'F', 'Production', 'Shift Supervisor', 'HSP', 'PLA', 32000, 42),
  /* 44 */ P('Mallikarjun', 'Biradar', 'M', 'Production', 'Shift Supervisor', 'HSP', 'PLB', 31500, 42),
  /* 45 */ P('Yellamma', 'Kattimani', 'F', 'Production', 'Machine Operator', 'HSP', 'PLA', 16500, 43, undefined, true),
  /* 46 */ P('Hanumanthappa', 'Doddamani', 'M', 'Production', 'Machine Operator', 'HSP', 'PLA', 17000, 43, undefined, true),
  /* 47 */ P('Savitha', 'Kulkarni', 'F', 'Production', 'Packing Operator', 'HSP', 'PLA', 15000, 43, undefined, true),
  /* 48 */ P('Kiran', 'Lamani', 'M', 'Production', 'Machine Operator', 'HSP', 'PLA', 16800, 43, undefined, true),
  /* 49 */ P('Roopa', 'Badiger', 'F', 'Production', 'Packing Operator', 'HSP', 'PLB', 15000, 44, undefined, true),
  /* 50 */ P('Praveen', 'Hugar', 'M', 'Production', 'Machine Operator', 'HSP', 'PLB', 16900, 44, undefined, true),
  /* 51 */ P('Geetha', 'Naik', 'F', 'Production', 'Packing Operator', 'HSP', 'PLA', 15200, 43, undefined, true),
  /* 52 */ P('Shankar', 'Pujar', 'M', 'Production', 'Helper', 'HSP', 'PLB', 13500, 44, undefined, true),
  /* 53 */ P('Bharati', 'Hosmani', 'F', 'Production', 'Packing Operator', 'HSP', 'PLB', 15100, 44, undefined, true),
  /* 54 */ P('Vinod', 'Chavan', 'M', 'Production', 'Machine Operator', 'HSP', 'PLA', 17200, 43, undefined, true),
  /* 55 */ P('Parvati', 'Gouda', 'F', 'Production', 'Helper', 'HSP', 'PLA', 13200, 43, undefined, true),
  /* 56 */ P('Ajay', 'Rathod', 'M', 'Production', 'Machine Operator', 'HSP', 'PLB', 16700, 44, undefined, true),
  /* 57 */ P('Kavitha', 'Madar', 'F', 'Production', 'Packing Operator', 'HSP', 'PLB', 15000, 44, undefined, true),
  /* 58 */ P('Santosh', 'Walikar', 'M', 'Production', 'Helper', 'HSP', 'PLA', 13000, 43, addDays(TODAY, -8), true),
  /* 59 */ P('Asha', 'Banakar', 'F', 'Production', 'Trainee Operator', 'HSP', 'PLA', 12500, 43, addDays(TODAY, 6), true),
];

/** "MM-DD", `days` from today: a join date whose anniversary falls soon. */
function anniversarySoon(days: number): string {
  return addDays(istToday(), days).slice(5);
}

const SITES: Record<Site, { name: string; state: string; city: string }> = {
  BLR: { name: 'Bengaluru head office', state: 'Karnataka', city: 'Bengaluru' },
  HSP: { name: 'Hosapete plant', state: 'Karnataka', city: 'Hosapete' },
  PNQ: { name: 'Pune sales office', state: 'Maharashtra', city: 'Pune' },
};

const SHIFTS: Record<Exclude<ShiftCode, 'GEN'>, { name: string; startTime: string; endTime: string }> = {
  PLA: { name: 'Plant morning', startTime: '06:00', endTime: '14:00' },
  PLB: { name: 'Plant evening', startTime: '14:00', endTime: '22:00' },
  NGT: { name: 'Night', startTime: '22:00', endTime: '06:00' },
};
const SHIFT_MINUTES: Record<ShiftCode, [number, number]> = {
  GEN: [570, 1110], PLA: [360, 840], PLB: [840, 1320], NGT: [1320, 360],
};

/**
 * An invented company's calendar, for a demo — check a real one against the
 * state's gazette. `site` limits a holiday to one office.
 */
const HOLIDAYS: { date: string; name: string; sites?: Site[] }[] = [
  { date: '2026-01-14', name: 'Makara Sankranti' },
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-03-19', name: 'Ugadi' },
  { date: '2026-05-01', name: 'May Day' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-09-14', name: 'Ganesh Chaturthi' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Vijayadashami' },
  { date: '2026-11-01', name: 'Kannada Rajyotsava', sites: ['BLR', 'HSP'] },
  { date: '2026-11-10', name: 'Deepavali' },
  { date: '2026-12-25', name: 'Christmas' },
  { date: '2027-01-15', name: 'Makara Sankranti' },
  { date: '2027-01-26', name: 'Republic Day' },
];

// --- Talking to the API ----------------------------------------------------------
let token = '';
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(`Could not reach the API at ${API}. Start it first: npm run dev:api`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const pan = (p: Person, i: number) =>
  `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 7) % 26))}${String.fromCharCode(65 + ((i * 3) % 26))}P${p.last.charAt(0).toUpperCase()}${String(1000 + i * 37).slice(-4)}${String.fromCharCode(65 + ((i * 11) % 26))}`;

// --- Run --------------------------------------------------------------------------
async function main() {
  if (!OWNER_DB) throw new Error('MIGRATION_DATABASE_URL is not set (.env) — the seed writes punch history as the owner.');
  const db = new pg.Pool({ connectionString: OWNER_DB, max: 2 });

  try {
    console.log(`Seeding Tungabhadra Organics through ${API} …`);

    // Signup: the company, its roles, its default leave types and shift.
    const signup = await call<{ accessToken: string; activeTenant: { id: string } }>('POST', '/auth/signup', {
      companyName: 'Tungabhadra Organics Pvt Ltd',
      adminFirstName: 'Priya',
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
    });
    token = signup.accessToken;
    const tenantId = signup.activeTenant.id;
    console.log('  ✓ company signed up');

    await call('PATCH', '/company/statutory', {
      epfRegistered: true, epfEstablishmentCode: 'KNBNG0045678000', epfRegisteredFrom: '2017-04-01',
      esiRegistered: true, esiEstablishmentCode: '53000123450001001', esiRegisteredFrom: '2017-04-01',
    });
    await call('PUT', '/leave/settings', { weeklyOffDays: [0, 6] });

    // Org units.
    const locationId: Partial<Record<Site, string>> = {};
    for (const site of Object.values(SITES)) await call('POST', '/org/locations', site);
    const departments = [...new Set(PEOPLE.map((p) => p.dept))];
    for (const name of departments) await call('POST', '/org/departments', { name });
    const designations = [...new Set(PEOPLE.map((p) => p.title))];
    for (const name of designations) await call('POST', '/org/designations', { name });
    const org = await call<{ locations: { id: string; name: string }[]; departments: { id: string; name: string }[]; designations: { id: string; name: string }[] }>('GET', '/org');
    for (const [code, site] of Object.entries(SITES) as [Site, (typeof SITES)[Site]][]) {
      locationId[code] = org.locations.find((l) => l.name === site.name)!.id;
    }
    const deptId = new Map(org.departments.map((d) => [d.name, d.id]));
    const titleId = new Map(org.designations.map((d) => [d.name, d.id]));
    console.log(`  ✓ ${org.locations.length} locations, ${departments.length} departments, ${designations.length} designations`);

    // Shifts: the default General one came with signup.
    const shiftId: Partial<Record<ShiftCode, string>> = {};
    for (const [code, s] of Object.entries(SHIFTS) as [Exclude<ShiftCode, 'GEN'>, (typeof SHIFTS)['PLA']][]) {
      const created = await call<{ id: string }>('POST', '/attendance/shifts', { code, ...s, graceMinutes: 10 });
      shiftId[code] = created.id;
    }
    const shifts = await call<{ id: string; isDefault: boolean }[]>('GET', '/attendance/shifts');
    shiftId.GEN = shifts.find((s) => s.isDefault)!.id;
    console.log('  ✓ shifts: general, plant morning, plant evening, night');

    // People first; managers in a second pass, since some report to someone
    // further down the list (maintenance answers to the production manager).
    const ids: string[] = [];
    for (const [i, p] of PEOPLE.entries()) {
      p.join ??= `${between(2018, YEAR - 1)}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`;
      const pfWage = Math.round(p.gross * (p.floor ? 0.6 : 0.5));
      const priorPf = !p.floor && chance(0.55);
      const created = await call<{ id: string }>('POST', '/employees', {
        empCode: `TBO-${String(i + 1).padStart(3, '0')}`,
        firstName: p.first,
        lastName: p.last,
        gender: p.gender,
        dateOfBirth: `${between(1968, 2003)}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`,
        ...(p.floor ? {} : { workEmail: `${p.first}.${p.last.replace(/\W/g, '')}@${DOMAIN}`.toLowerCase() }),
        phone: `+91 9${between(100000000, 999999999)}`,
        joinDate: p.join,
        locationId: locationId[p.site],
        departmentId: deptId.get(p.dept),
        designationId: titleId.get(p.title),
        pan: pan(p, i),
        ...(priorPf ? { uan: `10${between(1000000000, 9999999999)}` } : {}),
        pfWageAtJoiningRupees: pfWage,
        hasPriorPfMembership: priorPf,
        grossMonthlyRupees: p.gross,
      });
      ids.push(created.id);
    }
    for (const [i, p] of PEOPLE.entries()) {
      if (p.reportsTo !== undefined) await call('PATCH', `/employees/${ids[i]}`, { managerId: ids[p.reportsTo] });
    }
    // Lifecycle (confirmation, exit) is not built; everyone already here is active.
    await db.query(`update employee set status = 'ACTIVE' where tenant_id = $1 and join_date <= $2`, [tenantId, TODAY]);
    console.log(`  ✓ ${PEOPLE.length} employees`);

    // Rosters: the plant works a six-day week; office staff take the company's.
    const rosterOf = new Map<number, { from: string; shift: ShiftCode; offs: number[] }[]>();
    for (const [i, p] of PEOPLE.entries()) {
      if (p.site !== 'HSP') continue;
      const entries = [{ from: p.join!, shift: p.shift, offs: [0] }];
      // One person moved shifts last month: a roster is a timeline.
      if (i === 48) entries.push({ from: addDays(TODAY, -40), shift: 'PLB', offs: [0] });
      for (const e of entries) {
        await call('POST', '/attendance/roster', { employeeId: ids[i], shiftId: shiftId[e.shift], effectiveFrom: e.from, weeklyOffDays: e.offs });
      }
      rosterOf.set(i, entries);
    }
    console.log(`  ✓ rosters for ${rosterOf.size} plant staff`);

    for (const h of HOLIDAYS) {
      const sites = h.sites ?? [null];
      for (const s of sites) await call('POST', '/leave/holidays', { date: h.date, name: h.name, locationId: s ? locationId[s] : null });
    }
    console.log(`  ✓ ${HOLIDAYS.length} holidays`);

    const accrued = await call<{ posted: number }>('POST', '/leave/accruals', { through: TODAY.slice(0, 7) });
    console.log(`  ✓ leave credited through ${TODAY.slice(0, 7)} (${accrued.posted} ledger lines)`);

    // The admin is an employee here too: her login sees her own day and leave.
    const [admin] = (await db.query<{ user_id: string }>(
      `select ut.user_id from user_tenant ut join "user" u on u.id = ut.user_id where ut.tenant_id = $1 and u.email = $2`,
      [tenantId, ADMIN_EMAIL],
    )).rows;
    await db.query(`update user_tenant set employee_id = $1 where tenant_id = $2 and user_id = $3`, [ids[2], tenantId, admin!.user_id]);

    // --- Who works when ----------------------------------------------------------
    const holidaysAt = (site: Site) =>
      new Set(HOLIDAYS.filter((h) => !h.sites || h.sites.includes(site)).map((h) => h.date));
    const dayFor = (i: number, d: string): { shift: ShiftCode; offs: number[] } => {
      const entries = rosterOf.get(i);
      if (!entries) return { shift: 'GEN', offs: [0, 6] };
      const current = [...entries].reverse().find((e) => e.from <= d) ?? entries[0]!;
      return { shift: current.shift, offs: current.offs };
    };
    const works = (i: number, d: string) =>
      d >= PEOPLE[i]!.join! && !dayFor(i, d).offs.includes(weekday(d)) && !holidaysAt(PEOPLE[i]!.site).has(d);

    // --- Leave -------------------------------------------------------------------
    const types = await call<{ id: string; code: string }[]>('GET', '/leave/types');
    const typeId = new Map(types.map((t) => [t.code, t.id]));
    const taken = new Map<number, Set<string>>();
    const fullDayOff = new Map<number, Set<string>>();
    // What approval would refuse: more than a balance holds. Kept well inside
    // each type's yearly credit, pro-rata joiners included.
    const held = new Map<string, number>();
    const CAP = { CL: 600, SL: 600, EL: 800 } as const;
    const halfDayOff = new Map<number, Map<string, 'FIRST' | 'SECOND'>>();
    let requests = 0;

    interface Req {
      i: number; code: 'CL' | 'SL' | 'EL'; start: string; end: string;
      startSession?: 'FIRST' | 'SECOND'; endSession?: 'FIRST' | 'SECOND';
      status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'CANCELLED'; reason: string; note?: string;
    }
    const addRequest = async (r: Req) => {
      const startSession = r.startSession ?? 'FIRST';
      const endSession = r.endSession ?? 'SECOND';
      if (r.start.slice(0, 4) !== r.end.slice(0, 4) || r.start.slice(0, 4) !== String(YEAR)) return;
      const used = taken.get(r.i) ?? new Set<string>();
      let hundredths = 0;
      const dates: string[] = [];
      for (let d = r.start; d <= r.end; d = addDays(d, 1)) {
        if (used.has(d)) return;
        if (!works(r.i, d)) continue;
        let v = 100;
        if (d === r.start && startSession === 'SECOND') v -= 50;
        if (d === r.end && endSession === 'FIRST') v -= 50;
        hundredths += v;
        dates.push(d);
      }
      if (hundredths <= 0) return;
      const holds = r.status === 'APPROVED' || r.status === 'PENDING';
      const key = `${r.i}:${r.code}`;
      if (holds && (held.get(key) ?? 0) + hundredths > CAP[r.code]) return;
      if (holds) held.set(key, (held.get(key) ?? 0) + hundredths);
      const decided = r.status === 'APPROVED' || r.status === 'REJECTED';
      const createdAt = istInstant(addDays(r.start, -between(3, 12)), between(600, 1080));
      if (createdAt > NOW) createdAt.setTime(NOW.getTime() - between(1, 48) * 3_600_000);
      const decidedAt = decided ? new Date(Math.min(createdAt.getTime() + between(2, 30) * 3_600_000, NOW.getTime())) : null;
      const { rows: [row] } = await db.query<{ id: string }>(
        `insert into leave_request (tenant_id, employee_id, leave_type_id, start_date, start_session, end_date, end_session,
           days_hundredths, reason, status, decided_by_user_id, decided_at, decision_note, cancelled_at, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) returning id`,
        [tenantId, ids[r.i], typeId.get(r.code), r.start, startSession, r.end, endSession, hundredths, r.reason, r.status,
          decided ? admin!.user_id : null, decidedAt, r.note ?? null,
          r.status === 'CANCELLED' ? new Date(Math.min(createdAt.getTime() + between(1, 20) * 3_600_000, NOW.getTime())) : null, createdAt],
      );
      if (r.status === 'APPROVED') {
        await db.query(
          `insert into leave_txn (tenant_id, employee_id, leave_type_id, calendar_year, kind, days_hundredths, leave_request_id, created_by, created_at)
           values ($1,$2,$3,$4,'DEBIT',$5,$6,$7,$8)`,
          [tenantId, ids[r.i], typeId.get(r.code), YEAR, -hundredths, row!.id, admin!.user_id, decidedAt],
        );
        for (const d of dates) {
          const half = d === r.start && startSession === 'SECOND' ? 'SECOND' : d === r.end && endSession === 'FIRST' ? 'FIRST' : null;
          if (half) {
            const m = halfDayOff.get(r.i) ?? new Map();
            m.set(d, half);
            halfDayOff.set(r.i, m);
          } else {
            const s = fullDayOff.get(r.i) ?? new Set();
            s.add(d);
            fullDayOff.set(r.i, s);
          }
        }
      }
      if (r.status === 'APPROVED' || r.status === 'PENDING') {
        for (let d = r.start; d <= r.end; d = addDays(d, 1)) used.add(d);
        taken.set(r.i, used);
      }
      requests++;
    };

    /** The `n`th working day for person i on or after d. */
    const nthWorkingDay = (i: number, d: string, n: number) => {
      let left = n;
      let day = d;
      for (;;) {
        if (works(i, day)) left--;
        if (left <= 0) return day;
        day = addDays(day, 1);
      }
    };

    const REASONS = {
      CL: ['Family function', 'Personal work', 'Bank and RTO work', 'Child’s school event', 'House shifting'],
      SL: ['Fever', 'Viral infection', 'Doctor’s appointment', 'Migraine', 'Dental treatment'],
      EL: ['Family trip', 'Hometown visit', 'Sister’s wedding', 'Pilgrimage', 'Vacation'],
    } as const;

    // Today and the coming weeks: who is out, and what is waiting on a decision.
    const yearEnd = `${YEAR}-12-31`;
    const soon = (i: number, from: number, n: number) => {
      const start = nthWorkingDay(i, addDays(TODAY, from), 1);
      return { start, end: nthWorkingDay(i, start, n) };
    };
    const plan: Req[] = [];
    const todayOut = (i: number, code: Req['code'], back: number, forward: number, reason: string) => {
      if (!works(i, TODAY)) return;
      plan.push({ i, code, start: addDays(TODAY, -back), end: addDays(TODAY, forward), status: 'APPROVED', reason });
    };
    todayOut(14, 'EL', 1, 2, 'Sister’s wedding');
    todayOut(50, 'SL', 0, 0, 'Fever');
    todayOut(28, 'EL', 0, 3, 'Hometown visit');
    if (works(9, TODAY)) plan.push({ i: 9, code: 'CL', start: TODAY, end: TODAY, startSession: 'SECOND', endSession: 'SECOND', status: 'APPROVED', reason: 'Bank work' });

    const upcoming: [number, Req['code'], number, number, Req['status'], string][] = [
      [17, 'CL', 5, 1, 'APPROVED', 'Personal work'],
      [36, 'EL', 26, 4, 'APPROVED', 'Family trip'],
      [3, 'EL', 9, 2, 'PENDING', 'Hometown visit'],
      [15, 'CL', 4, 1, 'PENDING', 'Family function'],
      [29, 'SL', 1, 1, 'PENDING', 'Doctor’s appointment'],
      [47, 'EL', 12, 3, 'PENDING', 'Pilgrimage'],
      [8, 'CL', 7, 1, 'PENDING', 'Child’s school event'],
      [39, 'EL', 18, 5, 'PENDING', 'Vacation'],
      [2, 'EL', 30, 3, 'PENDING', 'Year-end break with family'],
    ];
    for (const [i, code, from, n, status, reason] of upcoming) {
      const { start, end } = soon(i, from, n);
      if (end <= yearEnd) plan.push({ i, code, start, end, status, reason });
    }

    // This year so far: one to three past requests each, mostly approved.
    const yearStart = `${YEAR}-01-05`;
    for (const [i, p] of PEOPLE.entries()) {
      if (p.join! > `${YEAR}-06-30`) continue;
      const count = between(1, 3);
      for (let k = 0; k < count; k++) {
        const code: Req['code'] = p.join! <= `${YEAR}-02-01` && chance(0.35) ? 'EL' : chance(0.55) ? 'CL' : 'SL';
        const n = code === 'EL' ? between(2, 4) : code === 'SL' ? between(1, 2) : 1;
        const earliest = p.join! > yearStart ? p.join! : yearStart;
        const span = Math.max(1, Math.floor((Date.parse(addDays(TODAY, -10)) - Date.parse(earliest)) / DAY));
        const start = nthWorkingDay(i, addDays(earliest, between(0, span)), 1);
        const end = nthWorkingDay(i, start, n);
        if (end >= TODAY) continue;
        const roll = rand();
        const status: Req['status'] = roll < 0.86 ? 'APPROVED' : roll < 0.93 ? 'REJECTED' : 'CANCELLED';
        const half = code === 'CL' && chance(0.25);
        plan.push({
          i, code, start, end, status, reason: pick(REASONS[code]),
          ...(half ? { endSession: 'FIRST' as const } : {}),
          ...(status === 'REJECTED' ? { note: pick(['Month-end close; please move it a week', 'Audit that week — can we do the week after?', 'Two others already off that day']) } : {}),
        });
      }
    }
    for (const r of plan) await addRequest(r);
    console.log(`  ✓ ${requests} leave requests`);

    // --- Punches -----------------------------------------------------------------
    const punchEmp: string[] = [];
    const punchAt: Date[] = [];
    const punchDir: string[] = [];
    const from = addDays(TODAY, -95);
    for (const [i, p] of PEOPLE.entries()) {
      if (p.join! > TODAY) continue;
      for (let d = p.join! > from ? p.join! : from; d <= TODAY; d = addDays(d, 1)) {
        if (!works(i, d) || fullDayOff.get(i)?.has(d)) continue;
        if (chance(0.025)) continue; // absent, unannounced
        const { shift } = dayFor(i, d);
        const [start, endRaw] = SHIFT_MINUTES[shift];
        const end = endRaw <= start ? endRaw + 1440 : endRaw;
        const half = halfDayOff.get(i)?.get(d);
        const late = chance(0.07);
        let inMin = late ? start + between(12, 40) : start - between(2, 18);
        let outMin = end + between(0, 35);
        if (half === 'FIRST') inMin = start + 270 + between(-10, 10);
        if (half === 'SECOND') outMin = start + 240 + between(0, 15);
        const inAt = istInstant(d, inMin);
        const outAt = istInstant(d, outMin);
        if (inAt <= NOW) { punchEmp.push(ids[i]!); punchAt.push(inAt); punchDir.push('IN'); }
        if (outAt <= NOW && !chance(0.02)) { punchEmp.push(ids[i]!); punchAt.push(outAt); punchDir.push('OUT'); }
      }
    }
    await db.query(
      `insert into punch_event (tenant_id, employee_id, punched_at, direction, source, created_at)
       select $1, e, a, d::punch_direction, 'WEB', a from unnest($2::uuid[], $3::timestamptz[], $4::text[]) as t(e, a, d)`,
      [tenantId, punchEmp, punchAt, punchDir],
    );
    console.log(`  ✓ ${punchAt.length} punches over the last ${Math.round((Date.parse(TODAY) - Date.parse(from)) / DAY)} days`);

    console.log(`
Done. Sign in at http://localhost:5173/login
  ${ADMIN_EMAIL}
  ${ADMIN_PASSWORD}
Everyone in it is invented; the .example addresses cannot receive mail.`);
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => {
  console.error(`\nSeed failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
