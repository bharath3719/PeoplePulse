import { Module, Global, Logger, type OnApplicationBootstrap, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDb, assertRlsEnforced, type Database } from '@peoplepulse/db';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Database =>
        getDb(config.getOrThrow<string>('DATABASE_URL')),
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Refuse to serve traffic if tenant isolation is not actually in force.
   *
   * This is not a health check. It is the last line standing between a
   * misconfiguration and every customer reading every other customer's payroll.
   *
   * It exists because we shipped — for about an hour — a system with correct
   * RLS policies on all 11 tables, ENABLE and FORCE set on every one, a
   * migration that verified both and reported success, and NO TENANT ISOLATION
   * WHATSOEVER. The app was connecting as `postgres`, and PostgreSQL superusers
   * skip row-level security entirely: the policies are never even consulted.
   *
   * Nothing in the schema reveals this. You have to check the ROLE.
   *
   * See ADR-006. Never downgrade this to a warning.
   */
  async onApplicationBootstrap(): Promise<void> {
    await assertRlsEnforced(this.db);
    this.logger.log('✓ tenant isolation verified — RLS enforced, connected as a non-superuser');
  }
}
