import { Controller, Post, Get, Req, HttpCode } from '@nestjs/common';
import { Public, SkipMfa } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody } from '../../platform/validation/zod.pipe';
import { AuthService } from '../../platform/auth/auth.service';
import { TenantService } from '../tenant/tenant.service';
import {
  loginSchema, signupSchema, switchTenantSchema, mfaVerifySchema,
  type LoginInput, type SignupInput,
} from './auth.dto';
import type { AuthedRequest } from '../../platform/auth/authed-request';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tenants: TenantService,
  ) {}

  /** Self-serve company signup (TR-02, NFR-09). */
  @Post('signup')
  @Public()
  async signup(@ZodBody(signupSchema) input: SignupInput) {
    const { tenantId } = await this.tenants.signup(input);
    // Log them straight in — a signup that then asks you to log in is friction
    // in the first 30 seconds of a 30-minute onboarding target.
    return this.auth.login(input.adminEmail, input.adminPassword, tenantId);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  login(@ZodBody(loginSchema) input: LoginInput) {
    return this.auth.login(input.email, input.password, input.tenantId);
  }

  /**
   * MFA verification runs on a HALF-authenticated token: the password was
   * right, but the second factor is outstanding. @SkipMfa lets this one through
   * the very check it exists to satisfy.
   */
  @Post('mfa/verify')
  @SkipMfa()
  @HttpCode(200)
  verifyMfa(@Req() req: AuthedRequest, @ZodBody(mfaVerifySchema) input: { code: string }) {
    const actor = actorOrThrow(req);
    return this.auth.verifyMfa(actor.userId, actor.tenantId, input.code);
  }

  /**
   * Switch company (D-16). The CA firm's accountant serving five of our
   * customers picks which one they are looking at; the token is re-issued.
   *
   * Membership is re-checked here, never trusted from the old token — access may
   * have been revoked since it was minted.
   */
  @Post('switch-tenant')
  @SkipMfa()
  @HttpCode(200)
  switchTenant(@Req() req: AuthedRequest, @ZodBody(switchTenantSchema) input: { tenantId: string }) {
    return this.auth.switchTenant(actorOrThrow(req).userId, input.tenantId);
  }

  /** Who am I, where am I, and what may I do? The web app boots from this. */
  @Get('me')
  @SkipMfa()
  me(@Req() req: AuthedRequest) {
    const actor = actorOrThrow(req);
    return {
      userId: actor.userId,
      tenantId: actor.tenantId,
      employeeId: actor.employeeId,
      mfaVerified: actor.mfaVerified,
      permissions: [...actor.permissions],
    };
  }
}
