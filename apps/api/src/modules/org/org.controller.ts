import { Controller, Get, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody } from '../../platform/validation/zod.pipe';
import { OrgService } from './org.service';
import type { AuthedRequest } from '../../platform/auth/authed-request';

const locationSchema = z.object({
  name: z.string().min(1).max(80),
  // Free text, not an enum: adding a state must be data, not a migration
  // (NFR-12). V1 populates Karnataka only.
  state: z.string().min(2).max(40),
  city: z.string().max(60).optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  geoRadiusMeters: z.number().int().positive().max(10_000).optional(),
});

const namedSchema = z.object({ name: z.string().min(1).max(80), code: z.string().max(20).optional() });
const gradeSchema = z.object({ name: z.string().min(1).max(80), level: z.number().int().optional() });

@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get()
  @RequirePermission('org.view')
  listAll(@Req() req: AuthedRequest) {
    return this.org.listAll(actorOrThrow(req));
  }

  @Post('locations')
  @RequirePermission('org.manage')
  createLocation(@Req() req: AuthedRequest, @ZodBody(locationSchema) input: z.infer<typeof locationSchema>) {
    return this.org.createLocation(actorOrThrow(req), input);
  }

  @Post('departments')
  @RequirePermission('org.manage')
  createDepartment(@Req() req: AuthedRequest, @ZodBody(namedSchema) input: z.infer<typeof namedSchema>) {
    return this.org.createDepartment(actorOrThrow(req), input);
  }

  @Post('designations')
  @RequirePermission('org.manage')
  createDesignation(@Req() req: AuthedRequest, @ZodBody(namedSchema) input: z.infer<typeof namedSchema>) {
    return this.org.createDesignation(actorOrThrow(req), input);
  }

  @Post('grades')
  @RequirePermission('org.manage')
  createGrade(@Req() req: AuthedRequest, @ZodBody(gradeSchema) input: z.infer<typeof gradeSchema>) {
    return this.org.createGrade(actorOrThrow(req), input);
  }
}
