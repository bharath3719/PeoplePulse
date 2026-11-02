import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';

import { DatabaseModule } from './platform/database/database.module';
import { AuthService } from './platform/auth/auth.service';
import { AuthGuard } from './platform/auth/auth.guard';
import { PermissionGuard } from './platform/rbac/permission.guard';
import { AuditService } from './platform/audit/audit.service';
import { PiiService } from './platform/crypto/pii.service';
import { MailService } from './platform/mail/mail.service';
import { RateLimitService } from './platform/rate-limit/rate-limit.service';

import { AuthController } from './modules/auth/auth.controller';
import { TenantService } from './modules/tenant/tenant.service';
import { TenantController } from './modules/tenant/tenant.controller';
import { EmployeeService } from './modules/employee/employee.service';
import { EmployeeImportService } from './modules/employee/employee-import.service';
import { EmployeeController } from './modules/employee/employee.controller';
import { OrgService } from './modules/org/org.service';
import { OrgController } from './modules/org/org.controller';
import { UserService } from './modules/user/user.service';
import { UserController } from './modules/user/user.controller';
import { LeaveService } from './modules/leave/leave.service';
import { LeaveLedgerService } from './modules/leave/leave-ledger.service';
import { LeavePolicyService } from './modules/leave/leave-policy.service';
import { LeaveController } from './modules/leave/leave.controller';
import { LeavePolicyController } from './modules/leave/leave-policy.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    JwtModule.register({}),
    DatabaseModule,
  ],
  controllers: [
    AuthController, TenantController, EmployeeController, OrgController, UserController,
    LeaveController, LeavePolicyController,
  ],
  providers: [
    AuthService, AuditService, PiiService, MailService, RateLimitService,
    TenantService, EmployeeService, EmployeeImportService, OrgService, UserService,
    LeaveService, LeaveLedgerService, LeavePolicyService,

    /**
     * Both guards are GLOBAL, and the order matters.
     *
     *   AuthGuard       — who are you?   (401 if unknown)
     *   PermissionGuard — may you?       (403 if not)
     *
     * Global registration means every route is protected UNLESS it is
     * explicitly @Public. A new endpoint that its author forgets to annotate
     * therefore fails CLOSED — nobody can call it — rather than silently
     * exposing employee data to the internet. The failure mode of
     * forgetfulness has to be inconvenient, not catastrophic.
     */
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
