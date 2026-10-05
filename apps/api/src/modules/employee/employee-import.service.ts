import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import {
  employee, employeeEvent, tenant, location, department, designation,
  withTenant, type Database,
} from '@peoplepulse/db';
import {
  derivePfStatusAtHire, deriveEsiStatusAtPeriodStart, hasPriorPfMembership, fromRupees,
  type Actor,
} from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';
import { PiiService } from '../../platform/crypto/pii.service';
import { importRowSchema, type ImportRow } from './employee-import.dto';

export interface RowError {
  row: number;          // 1-based, as the user sees it in Excel
  column: string;
  value: string;
  message: string;
}

export interface ImportReport {
  totalRows: number;
  valid: number;
  errors: RowError[];
  /** True only when nothing was written — a dry run, or a failed validation. */
  dryRun: boolean;
  imported: number;
}

/**
 * The columns of the import template, in order.
 *
 * `pfWageAtJoining` and `hasPriorPfMembership` are SEPARATE, EXPLICIT columns.
 *
 * They are not derived, and the import must never guess them from a salary
 * column — that would reintroduce the exact bug ADR-004 exists to prevent,
 * through the back door, at 200 rows a time. "Once a member, always a member"
 * is a fact about a person's history that only HR knows; a spreadsheet column
 * is the only place it can come from.
 */
const COLUMNS = [
  { key: 'empCode', header: 'Employee Code*', width: 16 },
  { key: 'firstName', header: 'First Name*', width: 18 },
  { key: 'lastName', header: 'Last Name', width: 18 },
  { key: 'joinDate', header: 'Join Date* (YYYY-MM-DD)', width: 22 },
  { key: 'dateOfBirth', header: 'Date of Birth (YYYY-MM-DD)', width: 24 },
  { key: 'gender', header: 'Gender (MALE/FEMALE/OTHER)', width: 26 },
  { key: 'workEmail', header: 'Work Email', width: 26 },
  { key: 'phone', header: 'Phone', width: 14 },
  { key: 'employmentType', header: 'Employment Type', width: 18 },
  { key: 'locationName', header: 'Location', width: 18 },
  { key: 'departmentName', header: 'Department', width: 18 },
  { key: 'designationName', header: 'Designation', width: 18 },
  { key: 'managerEmpCode', header: 'Manager Employee Code', width: 22 },
  { key: 'pan', header: 'PAN', width: 14 },
  { key: 'uan', header: 'UAN (12 digits)', width: 18 },
  { key: 'esicNumber', header: 'ESIC Number', width: 18 },
  { key: 'bankAccount', header: 'Bank Account', width: 20 },
  { key: 'bankIfsc', header: 'IFSC', width: 14 },
  { key: 'pfWageAtJoiningRupees', header: 'PF Wage at Joining (Basic+DA)', width: 30 },
  { key: 'hasPriorPfMembership', header: 'Had PF Before Joining? (YES/NO)', width: 32 },
  { key: 'grossMonthlyRupees', header: 'Gross Monthly Salary', width: 22 },
] as const;

@Injectable()
export class EmployeeImportService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly pii: PiiService,
  ) {}

  /** The blank template HR downloads and fills in (CHR-09). */
  async buildTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Employees');

    sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
    header.commit();

    // An example row, so the expected formats are unambiguous. HR will copy it.
    sheet.addRow({
      empCode: 'EMP001', firstName: 'Sneha', lastName: 'Rao',
      joinDate: '2026-04-01', dateOfBirth: '1995-06-15', gender: 'FEMALE',
      workEmail: 'sneha@company.in', phone: '9876543210', employmentType: 'FULL_TIME',
      locationName: 'Bengaluru HQ', departmentName: 'Production', designationName: 'Operator',
      managerEmpCode: '', pan: 'ABCDE1234F', uan: '100234567890', esicNumber: '',
      bankAccount: '50100123456789', bankIfsc: 'HDFC0001234',
      pfWageAtJoiningRupees: 12000, hasPriorPfMembership: 'NO', grossMonthlyRupees: 20000,
    });

    // A second sheet, because the PF columns WILL be filled in wrong otherwise.
    const help = wb.addWorksheet('Read Me');
    help.columns = [{ width: 34 }, { width: 96 }];
    help.addRows([
      ['Column', 'What to put in it'],
      ['PF Wage at Joining (Basic+DA)',
        'Basic + DA on the day they joined. NOT their current salary, and not their gross.'],
      ['Had PF Before Joining? (YES/NO)',
        'YES if they ever had a PF account at any previous employer. If they have a UAN, the answer is YES.'],
      ['', ''],
      ['Why these two matter',
        'They decide whether PF is deducted at all, and they are decided ONCE — at joining.'],
      ['',
        'Someone who joins on more than Rs 15,000 basic AND has never had PF before can be left out of the scheme.'],
      ['',
        'But someone who has had PF before stays in it FOREVER, at any salary. A later raise never changes either answer.'],
      ['',
        'Getting these wrong means deducting PF from someone who owes none, or missing it for someone who does.'],
    ]);
    help.getRow(1).font = { bold: true };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * Parse, validate, and (unless dryRun) import.
   *
   * ALL-OR-NOTHING. If any row fails validation, nothing is written.
   *
   * The alternative — import the good rows, report the bad ones — sounds
   * friendlier and is a trap: HR fixes the 3 broken rows, re-uploads the whole
   * file, and now has 197 duplicate-code errors and no idea which rows actually
   * landed. A partial import of a payroll master is worse than no import.
   */
  async importFile(actor: Actor, buffer: Buffer, dryRun: boolean): Promise<ImportReport> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('That file is not a readable .xlsx workbook');
    }

    const sheet = wb.getWorksheet('Employees') ?? wb.worksheets[0];
    if (!sheet) throw new BadRequestException('The workbook has no sheets');

    const errors: RowError[] = [];
    const parsed: { row: number; data: ImportRow }[] = [];
    const seenCodes = new Map<string, number>();

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // header

      const raw: Record<string, unknown> = {};
      COLUMNS.forEach((col, i) => {
        raw[col.key] = cellValue(row.getCell(i + 1));
      });

      // A wholly blank row is skipped, not reported — trailing blanks are how
      // spreadsheets are.
      if (Object.values(raw).every((v) => v === undefined || v === '')) return;

      const result = importRowSchema.safeParse(raw);
      if (!result.success) {
        for (const issue of result.error.errors) {
          const key = String(issue.path[0] ?? '');
          const column = COLUMNS.find((c) => c.key === key)?.header ?? key;
          errors.push({
            row: rowNumber,
            column,
            value: String(raw[key] ?? ''),
            message: issue.message,
          });
        }
        return;
      }

      // Duplicates WITHIN the file. The database unique constraint would catch
      // this too, but as one opaque failure at row 147 — this names both rows.
      const previous = seenCodes.get(result.data.empCode);
      if (previous !== undefined) {
        errors.push({
          row: rowNumber,
          column: 'Employee Code*',
          value: result.data.empCode,
          message: `Duplicate of row ${previous} — employee codes must be unique`,
        });
        return;
      }
      seenCodes.set(result.data.empCode, rowNumber);
      parsed.push({ row: rowNumber, data: result.data });
    });

    const totalRows = parsed.length + new Set(errors.map((e) => e.row)).size;

    if (errors.length > 0 || dryRun) {
      return { totalRows, valid: parsed.length, errors, dryRun: true, imported: 0 };
    }

    const imported = await this.writeAll(actor, parsed);
    return { totalRows, valid: parsed.length, errors: [], dryRun: false, imported };
  }

  private async writeAll(
    actor: Actor, rows: { row: number; data: ImportRow }[],
  ): Promise<number> {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [company] = await tx.select().from(tenant).where(eq(tenant.id, actor.tenantId));
      if (!company) throw new BadRequestException('Company not found');

      const establishment = {
        epfRegistered: company.epfRegistered,
        esiRegistered: company.esiRegistered,
      };

      // Resolve org names -> ids once, rather than per row.
      const [locations, departments, designations] = await Promise.all([
        tx.select().from(location),
        tx.select().from(department),
        tx.select().from(designation),
      ]);
      const byName = <T extends { id: string; name: string }>(rowsIn: T[]) =>
        new Map(rowsIn.map((r) => [r.name.toLowerCase(), r.id]));
      const locMap = byName(locations);
      const depMap = byName(departments);
      const desMap = byName(designations);

      const existing = await tx.select({ empCode: employee.empCode }).from(employee)
        .where(inArray(employee.empCode, rows.map((r) => r.data.empCode)));
      if (existing.length > 0) {
        throw new BadRequestException({
          type: 'https://peoplepulse.in/errors/import-conflict',
          title: 'These employee codes already exist',
          codes: existing.map((e) => e.empCode),
        });
      }

      const values = rows.map(({ data }) => {
        const pfWageAtJoining = fromRupees(data.pfWageAtJoiningRupees ?? 0);

        /**
         * The SAME function the single-create path uses. Not a reimplementation.
         *
         * The import is exactly where a second, subtly-different copy of the PF
         * rules would grow — and it would be wrong in a way nobody notices until
         * 200 people have the wrong PF status.
         */
        const hasPrior = hasPriorPfMembership(data.hasPriorPfMembership, data.uan);

        return {
          tenantId: actor.tenantId,
          empCode: data.empCode,
          firstName: data.firstName,
          lastName: data.lastName ?? null,
          dateOfBirth: data.dateOfBirth ?? null,
          gender: data.gender ?? null,
          workEmail: data.workEmail ?? null,
          phone: data.phone ?? null,
          joinDate: data.joinDate,
          status: 'ONBOARDING' as const,
          employmentType: data.employmentType,
          locationId: data.locationName ? locMap.get(data.locationName.toLowerCase()) ?? null : null,
          departmentId: data.departmentName ? depMap.get(data.departmentName.toLowerCase()) ?? null : null,
          designationId: data.designationName ? desMap.get(data.designationName.toLowerCase()) ?? null : null,

          panEncrypted: data.pan ? this.pii.encrypt(data.pan) : null,
          panLast4: data.pan ? PiiService.last4(data.pan) : null,
          uan: data.uan ?? null,
          esicNumber: data.esicNumber ?? null,
          bankAccountEncrypted: data.bankAccount ? this.pii.encrypt(data.bankAccount) : null,
          bankAccountLast4: data.bankAccount ? PiiService.last4(data.bankAccount) : null,
          bankIfsc: data.bankIfsc ?? null,

          pfStatus: derivePfStatusAtHire(establishment, {
            pfWageAtJoining, hasPriorPfMembership: hasPrior,
          }),
          pfJoiningWagePaise: data.pfWageAtJoiningRupees === undefined ? null : pfWageAtJoining,
          hasPriorPfMembership: hasPrior,
          esiStatus: deriveEsiStatusAtPeriodStart(
            establishment, fromRupees(data.grossMonthlyRupees ?? 0),
          ),

          createdBy: actor.userId,
        };
      });

      const created = await tx.insert(employee).values(values)
        .returning({ id: employee.id, empCode: employee.empCode, joinDate: employee.joinDate });

      await tx.insert(employeeEvent).values(created.map((c) => ({
        tenantId: actor.tenantId,
        employeeId: c.id,
        type: 'JOIN' as const,
        effectiveDate: c.joinDate,
        payload: { source: 'excel-import' },
        createdBy: actor.userId,
      })));

      await this.audit.record(tx, actor, {
        entity: 'employee',
        action: 'BULK_IMPORT',
        after: { count: created.length, codes: created.map((c) => c.empCode).slice(0, 50) },
      });

      // Manager links are a second pass: a manager may appear LATER in the same
      // file than their report, so nothing can be resolved until every row exists.
      await this.linkManagers(tx, rows);

      return created.length;
    });
  }

  private async linkManagers(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    rows: { data: ImportRow }[],
  ): Promise<void> {
    const withManagers = rows.filter((r) => r.data.managerEmpCode);
    if (withManagers.length === 0) return;

    const all = await tx.select({ id: employee.id, empCode: employee.empCode }).from(employee);
    const idByCode = new Map(all.map((e) => [e.empCode, e.id]));

    for (const { data } of withManagers) {
      const managerId = idByCode.get(data.managerEmpCode!);
      const selfId = idByCode.get(data.empCode);
      if (!managerId || !selfId || managerId === selfId) continue;

      await tx.update(employee).set({ managerId }).where(eq(employee.id, selfId));
    }
  }
}

/** Excel cells arrive as strings, numbers, dates, formulas, or rich text. Flatten. */
function cellValue(cell: ExcelJS.Cell): string | number | undefined {
  const v = cell.value;
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim() || undefined;
  if (typeof v === 'object' && 'result' in v) return String(v.result).trim() || undefined;
  return String(v).trim() || undefined;
}
