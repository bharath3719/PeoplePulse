import {
  Controller, Get, Post, Patch, Put, Delete, Param, Query, Req, HttpCode, ParseUUIDPipe,
} from '@nestjs/common';
import { z } from 'zod';
import { leaveYearOf, toIstDate } from '@peoplepulse/core';
import { RequirePermission } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody, ZodValidationPipe } from '../../platform/validation/zod.pipe';
import { LeavePolicyService } from './leave-policy.service';
import {
  createHolidaySchema, createLeaveTypeSchema, leaveSettingsSchema, updateLeaveTypeSchema,
  type CreateHolidayInput, type CreateLeaveTypeInput, type LeaveSettingsInput, type UpdateLeaveTypeInput,
} from './leave.dto';
import type { AuthedRequest } from '../../platform/auth/authed-request';

const yearQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

/**
 * Leave policy: types, holidays, weekly offs (LVE-01, LVE-04).
 *
 * Reading it needs only membership of the company — it is the leave policy
 * every employee works under, not anyone's personal data, and the apply form
 * needs it. Changing it is `leave.manage`.
 */
@Controller('leave')
export class LeavePolicyController {
  constructor(private readonly policy: LeavePolicyService) {}

  @Get('types')
  listTypes(@Req() req: AuthedRequest) {
    return this.policy.listTypes(actorOrThrow(req));
  }

  @Post('types')
  @RequirePermission('leave.manage')
  createType(@Req() req: AuthedRequest, @ZodBody(createLeaveTypeSchema) input: CreateLeaveTypeInput) {
    return this.policy.createType(actorOrThrow(req), input);
  }

  /** Adds the standard types a company is missing — for companies created before leave existed. */
  @Post('types/defaults')
  @RequirePermission('leave.manage')
  @HttpCode(200)
  addDefaultTypes(@Req() req: AuthedRequest) {
    return this.policy.addDefaultTypes(actorOrThrow(req));
  }

  @Patch('types/:id')
  @RequirePermission('leave.manage')
  updateType(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateLeaveTypeSchema) input: UpdateLeaveTypeInput,
  ) {
    return this.policy.updateType(actorOrThrow(req), id, input);
  }

  @Get('holidays')
  listHolidays(
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(yearQuerySchema)) query: z.infer<typeof yearQuerySchema>,
  ) {
    return this.policy.listHolidays(actorOrThrow(req), query.year ?? leaveYearOf(toIstDate(new Date())));
  }

  @Post('holidays')
  @RequirePermission('leave.manage')
  createHoliday(@Req() req: AuthedRequest, @ZodBody(createHolidaySchema) input: CreateHolidayInput) {
    return this.policy.createHoliday(actorOrThrow(req), input);
  }

  @Delete('holidays/:id')
  @RequirePermission('leave.manage')
  @HttpCode(204)
  deleteHoliday(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.policy.deleteHoliday(actorOrThrow(req), id);
  }

  @Get('settings')
  settings(@Req() req: AuthedRequest) {
    return this.policy.settings(actorOrThrow(req));
  }

  @Put('settings')
  @RequirePermission('leave.manage')
  updateSettings(@Req() req: AuthedRequest, @ZodBody(leaveSettingsSchema) input: LeaveSettingsInput) {
    return this.policy.updateSettings(actorOrThrow(req), input);
  }
}
