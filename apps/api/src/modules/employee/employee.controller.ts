import {
  Controller, Get, Post, Delete, Param, Query, Req, HttpCode,
  UploadedFile, UseInterceptors, Res, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { RequirePermission } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody } from '../../platform/validation/zod.pipe';
import { EmployeeService } from './employee.service';
import { EmployeeImportService } from './employee-import.service';
import { createEmployeeSchema, toEmployeeView, type CreateEmployeeInput } from './employee.dto';
import type { AuthedRequest } from '../../platform/auth/authed-request';

/**
 * Thin by design.
 *
 * Notice what is NOT in any handler below: an authorization check, a role
 * comparison, a decision about who may see salary. The @RequirePermission
 * decorator is metadata read by a single guard; field redaction happens in the
 * serializer. The handler validates, delegates, and serializes.
 *
 * See ENGINEERING-STANDARDS.md §1 and §2.
 */
@Controller('employees')
export class EmployeeController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly imports: EmployeeImportService,
  ) {}

  /**
   * The blank template HR fills in (CHR-09).
   *
   * It carries a "Read Me" sheet explaining the two PF columns, because those
   * are the ones that will be filled in wrong — and filling them in wrong means
   * deducting PF from someone who owes none.
   */
  @Get('import/template')
  @RequirePermission('employee.import')
  async template(@Res() res: Response) {
    const buffer = await this.imports.buildTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="peoplepulse-employee-import.xlsx"',
    });
    res.send(buffer);
  }

  /**
   * Upload the filled template.
   *
   * ALL-OR-NOTHING: if any row fails validation, NOTHING is written and the
   * report names every bad row, column, and value. Importing the good rows and
   * reporting the bad ones sounds friendlier and is a trap — HR fixes three
   * rows, re-uploads the file, and gets 197 duplicate-code errors with no idea
   * what actually landed.
   *
   * `?dryRun=true` validates without writing. The UI calls this first, always,
   * so HR sees the report before committing.
   */
  @Post('import')
  @RequirePermission('employee.import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importFile(
    @Req() req: AuthedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRun?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.imports.importFile(actorOrThrow(req), file.buffer, dryRun === 'true');
  }

  @Get()
  @RequirePermission('employee.view')
  async list(@Req() req: AuthedRequest, @Query('search') search?: string) {
    const actor = actorOrThrow(req);
    const rows = await this.employees.list(actor, search);
    return { data: rows.map((row) => toEmployeeView(actor, row)) };
  }

  @Get(':id')
  @RequirePermission('employee.view')
  async findOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    const actor = actorOrThrow(req);
    return toEmployeeView(actor, await this.employees.findOne(actor, id));
  }

  @Post()
  @RequirePermission('employee.create')
  async create(
    @Req() req: AuthedRequest,
    @ZodBody(createEmployeeSchema) input: CreateEmployeeInput,
  ) {
    const actor = actorOrThrow(req);
    return toEmployeeView(actor, await this.employees.create(actor, input));
  }

  /**
   * Decrypt and return PAN / bank account. Separate endpoint, separate
   * permission, and every call is written to the audit log (TR-52).
   *
   * It is deliberately NOT part of the employee payload: a list of 200 people
   * must never decrypt 200 records, and must not write 200 audit entries. The
   * masked value on the list view is built from `panLast4`, stored in the clear.
   */
  @Get(':id/identifiers')
  @RequirePermission('employee.identifiers.view')
  reveal(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.employees.revealIdentifiers(actorOrThrow(req), id);
  }

  @Delete(':id')
  @RequirePermission('employee.delete')
  @HttpCode(200)
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.employees.remove(actorOrThrow(req), id);
  }
}
