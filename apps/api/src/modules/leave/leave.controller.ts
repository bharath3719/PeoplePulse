import { Controller, Get, Post, Param, Query, Req, HttpCode, ParseUUIDPipe } from '@nestjs/common';
import { z } from 'zod';
import { leaveYearOf, toIstDate } from '@peoplepulse/core';
import { RequirePermission } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody, ZodValidationPipe } from '../../platform/validation/zod.pipe';
import { LeaveService } from './leave.service';
import { LeaveLedgerService } from './leave-ledger.service';
import { LeaveYearEndService } from './leave-year-end.service';
import {
  applyLeaveSchema, leaveAdjustmentSchema, leaveDecisionSchema, leaveYearEndSchema, postAccrualsSchema,
  previewLeaveSchema,
  type ApplyLeaveInput, type LeaveAdjustmentInput, type LeaveDecisionInput, type LeaveYearEndInput,
  type PostAccrualsInput, type PreviewLeaveInput,
} from './leave.dto';
import type { AuthedRequest } from '../../platform/auth/authed-request';

const yearQuery = z.coerce.number().int().min(2000).max(2100).optional();

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  year: yearQuery,
});

const yearQuerySchema = z.object({ year: yearQuery });

/** The leave year an unqualified read is about: this one, in IST. */
function thisYear(): number {
  return leaveYearOf(toIstDate(new Date()));
}

/**
 * Leave requests and balances (LVE-03, LVE-05, LVE-08).
 *
 * The reads carry no @RequirePermission, and that is a decision, not an
 * omission: whose leave a caller sees is a SCOPE — their own, their team's,
 * everyone's — resolved in the service from the three `leave.view.*`
 * permissions. Someone holding none of them sees an empty list and a 404, the
 * same as for an employee outside their reach.
 */
@Controller('leave')
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly ledger: LeaveLedgerService,
    private readonly yearEnd: LeaveYearEndService,
  ) {}

  @Get('requests')
  list(@Req() req: AuthedRequest, @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.leave.list(actorOrThrow(req), query);
  }

  /** What a request would cost, before it is made. Checks everything applying checks; writes nothing. */
  @Post('requests/preview')
  @RequirePermission('leave.apply')
  @HttpCode(200)
  preview(@Req() req: AuthedRequest, @ZodBody(previewLeaveSchema) input: PreviewLeaveInput) {
    return this.leave.preview(actorOrThrow(req), input);
  }

  @Post('requests')
  @RequirePermission('leave.apply')
  apply(@Req() req: AuthedRequest, @ZodBody(applyLeaveSchema) input: ApplyLeaveInput) {
    return this.leave.apply(actorOrThrow(req), input);
  }

  @Post('requests/:id/decision')
  @RequirePermission('leave.approve')
  @HttpCode(200)
  decide(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(leaveDecisionSchema) input: LeaveDecisionInput,
  ) {
    return this.leave.decide(actorOrThrow(req), id, input);
  }

  @Post('requests/:id/cancel')
  @RequirePermission('leave.apply')
  @HttpCode(200)
  cancel(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.leave.cancel(actorOrThrow(req), id);
  }

  @Get('employees/:employeeId/balances')
  balances(
    @Req() req: AuthedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query(new ZodValidationPipe(yearQuerySchema)) query: z.infer<typeof yearQuerySchema>,
  ) {
    return this.ledger.balances(actorOrThrow(req), employeeId, query.year ?? thisYear());
  }

  @Get('employees/:employeeId/ledger')
  history(
    @Req() req: AuthedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query(new ZodValidationPipe(yearQuerySchema)) query: z.infer<typeof yearQuerySchema>,
  ) {
    return this.ledger.ledger(actorOrThrow(req), employeeId, query.year ?? thisYear());
  }

  @Post('adjustments')
  @RequirePermission('leave.manage')
  adjust(@Req() req: AuthedRequest, @ZodBody(leaveAdjustmentSchema) input: LeaveAdjustmentInput) {
    return this.ledger.adjust(actorOrThrow(req), input);
  }

  /** Idempotent: re-running a month posts nothing new. */
  @Post('accruals')
  @RequirePermission('leave.manage')
  @HttpCode(200)
  postAccruals(@Req() req: AuthedRequest, @ZodBody(postAccrualsSchema) input: PostAccrualsInput) {
    return this.ledger.postAccruals(actorOrThrow(req), input);
  }

  /** What closing the year would carry, encash and lapse. Writes nothing. */
  @Post('year-end/preview')
  @RequirePermission('leave.manage')
  @HttpCode(200)
  previewYearEnd(@Req() req: AuthedRequest, @ZodBody(leaveYearEndSchema) input: LeaveYearEndInput) {
    return this.yearEnd.preview(actorOrThrow(req), input);
  }

  /** Close a leave year (LVE-02). Re-runnable: a second close moves only what arrived since the first. */
  @Post('year-end')
  @RequirePermission('leave.manage')
  @HttpCode(200)
  closeYear(@Req() req: AuthedRequest, @ZodBody(leaveYearEndSchema) input: LeaveYearEndInput) {
    return this.yearEnd.close(actorOrThrow(req), input);
  }
}
