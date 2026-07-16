import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { location, department, designation, grade, withTenant, type Database } from '@peoplepulse/db';
import type { Actor } from '@peoplepulse/core';
import { DB } from '../../platform/database/database.module';
import { AuditService } from '../../platform/audit/audit.service';

/**
 * Org structure (CHR-02): location -> department -> designation -> grade.
 *
 * The LOCATION carries the state, and the state drives Professional Tax and LWF
 * (BRD §10). V1 supports Karnataka only (OPEN.md D-15) — but nothing here is
 * hardcoded to it. The engine stays state-agnostic even while one state is
 * populated, because adding a state must be a data exercise, not a migration
 * (NFR-12).
 */
@Injectable()
export class OrgService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listAll(actor: Actor) {
    return withTenant(this.db, actor.tenantId, async (tx) => ({
      locations: await tx.select().from(location),
      departments: await tx.select().from(department),
      designations: await tx.select().from(designation),
      grades: await tx.select().from(grade),
    }));
  }

  async createLocation(actor: Actor, input: {
    name: string; state: string; city?: string | undefined;
    geoLat?: number | undefined; geoLng?: number | undefined;
    geoRadiusMeters?: number | undefined;
  }) {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [created] = await tx.insert(location).values({
        tenantId: actor.tenantId,
        name: input.name,
        state: input.state,
        city: input.city ?? null,
        geoLat: input.geoLat ?? null,
        geoLng: input.geoLng ?? null,
        geoRadiusMeters: input.geoRadiusMeters ?? null,
      }).returning();

      await this.audit.record(tx, actor, {
        entity: 'location', entityId: created!.id, action: 'CREATE',
        after: { name: input.name, state: input.state },
      });
      return created;
    });
  }

  async createDepartment(actor: Actor, input: { name: string; code?: string | undefined }) {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [created] = await tx.insert(department).values({
        tenantId: actor.tenantId, name: input.name, code: input.code ?? null,
      }).returning();
      await this.audit.record(tx, actor, {
        entity: 'department', entityId: created!.id, action: 'CREATE', after: { name: input.name },
      });
      return created;
    });
  }

  async createDesignation(actor: Actor, input: { name: string }) {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [created] = await tx.insert(designation).values({
        tenantId: actor.tenantId, name: input.name,
      }).returning();
      await this.audit.record(tx, actor, {
        entity: 'designation', entityId: created!.id, action: 'CREATE', after: { name: input.name },
      });
      return created;
    });
  }

  async createGrade(actor: Actor, input: { name: string; level?: number | undefined }) {
    return withTenant(this.db, actor.tenantId, async (tx) => {
      const [created] = await tx.insert(grade).values({
        tenantId: actor.tenantId, name: input.name, level: input.level ?? null,
      }).returning();
      await this.audit.record(tx, actor, {
        entity: 'grade', entityId: created!.id, action: 'CREATE', after: { name: input.name },
      });
      return created;
    });
  }
}
