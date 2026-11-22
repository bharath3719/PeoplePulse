import { Controller, Get, Post, Patch, Param, Req, HttpCode, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody } from '../../platform/validation/zod.pipe';
import { ShiftService } from './shift.service';
import {
  createShiftSchema, updateShiftSchema,
  type CreateShiftInput, type UpdateShiftInput,
} from './attendance.dto';
import type { AuthedRequest } from '../../platform/auth/authed-request';

/**
 * Shifts (ATT-04). Reading them needs only membership of the company — they are
 * the hours everyone works to, not anyone's personal data. Changing them is
 * `attendance.manage`.
 */
@Controller('attendance/shifts')
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.shifts.list(actorOrThrow(req));
  }

  @Post()
  @RequirePermission('attendance.manage')
  create(@Req() req: AuthedRequest, @ZodBody(createShiftSchema) input: CreateShiftInput) {
    return this.shifts.create(actorOrThrow(req), input);
  }

  @Patch(':id')
  @RequirePermission('attendance.manage')
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateShiftSchema) input: UpdateShiftInput,
  ) {
    return this.shifts.update(actorOrThrow(req), id, input);
  }

  /** The shift for anyone on a date no roster entry covers. */
  @Post(':id/default')
  @RequirePermission('attendance.manage')
  @HttpCode(200)
  makeDefault(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.makeDefault(actorOrThrow(req), id);
  }
}
