import { Controller, Get, Patch, Req } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody } from '../../platform/validation/zod.pipe';
import { TenantService } from './tenant.service';
import type { AuthedRequest } from '../../platform/auth/authed-request';

/**
 * Statutory registration (ADR-004).
 *
 * These flags decide whether PF and ESI are computed AT ALL, for anybody. They
 * are set BY HR, explicitly, and are never inferred from headcount: EPF is
 * mandatory at 20+ employees, but a smaller company may register voluntarily
 * (EPF Act s1(4)), and crossing 20 employees does not register you by magic.
 *
 * Changing them is a Payroll Admin action and requires MFA, because it silently
 * changes what every future employee's payslip contains.
 */
const statutorySchema = z.object({
  epfRegistered: z.boolean().optional(),
  epfEstablishmentCode: z.string().max(30).optional(),
  epfRegisteredFrom: z.string().date().optional(),

  esiRegistered: z.boolean().optional(),
  esiEstablishmentCode: z.string().max(30).optional(),
  esiRegisteredFrom: z.string().date().optional(),

  /** OPEN.md D-10: restrict PF wage to the Rs 15,000 ceiling, or use actual. */
  pfRestrictToCeiling: z.boolean().optional(),
});

@Controller('company')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get('settings')
  @RequirePermission('tenant.settings')
  settings(@Req() req: AuthedRequest) {
    return this.tenants.settings(actorOrThrow(req).tenantId);
  }

  @Patch('statutory')
  @RequirePermission('payroll.statutory.manage')
  updateStatutory(
    @Req() req: AuthedRequest,
    @ZodBody(statutorySchema) input: z.infer<typeof statutorySchema>,
  ) {
    return this.tenants.updateStatutory(actorOrThrow(req), input);
  }
}
