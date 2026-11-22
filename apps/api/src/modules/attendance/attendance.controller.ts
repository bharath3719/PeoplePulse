import { Controller, Get, Post, Delete, Param, Query, Req, HttpCode, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody, ZodValidationPipe } from '../../platform/validation/zod.pipe';
import { PunchService } from './punch.service';
import { RosterService } from './roster.service';
import {
  assignRosterSchema, punchRangeSchema, punchSchema,
  type AssignRosterInput, type PunchInput, type PunchRangeInput,
} from './attendance.dto';
import type { AuthedRequest } from '../../platform/auth/authed-request';

/**
 * Punches and rosters (ATT-02, ATT-04).
 *
 * The per-employee reads carry no @RequirePermission, as leave's do not: whose
 * attendance a caller sees is a SCOPE — their own, their team's, everyone's —
 * resolved in the service from the three `attendance.view.*` permissions.
 * Outside it, an employee is a 404, the same as one in another company.
 */
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly punches: PunchService,
    private readonly rosters: RosterService,
  ) {}

  /** Your punch card: today's attendance day, and whether the next punch is in or out. */
  @Get('me')
  @RequirePermission('attendance.punch')
  status(@Req() req: AuthedRequest) {
    return this.punches.status(actorOrThrow(req));
  }

  /** Punch in or out, now, by the server's clock. Always for yourself. */
  @Post('punches')
  @RequirePermission('attendance.punch')
  punch(@Req() req: AuthedRequest, @ZodBody(punchSchema) input: PunchInput) {
    return this.punches.punch(actorOrThrow(req), input);
  }

  @Get('employees/:employeeId/days')
  days(
    @Req() req: AuthedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query(new ZodValidationPipe(punchRangeSchema)) range: PunchRangeInput,
  ) {
    return this.punches.days(actorOrThrow(req), employeeId, range);
  }

  @Get('employees/:employeeId/roster')
  roster(@Req() req: AuthedRequest, @Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.rosters.forEmployee(actorOrThrow(req), employeeId);
  }

  @Post('roster')
  @RequirePermission('attendance.manage')
  assign(@Req() req: AuthedRequest, @ZodBody(assignRosterSchema) input: AssignRosterInput) {
    return this.rosters.assign(actorOrThrow(req), input);
  }

  @Delete('roster/:id')
  @RequirePermission('attendance.manage')
  @HttpCode(204)
  removeRosterEntry(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.rosters.remove(actorOrThrow(req), id);
  }
}
