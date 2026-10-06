import { Controller, Post, Get, Req, HttpCode } from '@nestjs/common';
import { Public, SkipMfa } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody } from '../../platform/validation/zod.pipe';
import { AuthService } from '../../platform/auth/auth.service';
import { TenantService } from '../tenant/tenant.service';
import { UserService } from '../user/user.service';
import {
  loginSchema, signupSchema, switchTenantSchema, mfaVerifySchema,
  invitationTokenSchema, acceptInvitationSchema,
  type LoginInput, type SignupInput,
} from './auth.dto';
import type { AuthedRequest } from '../../platform/auth/authed-request';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tenants: TenantService,
    private readonly users: UserService,
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

  /**
   * What an invitation link is for, before the invitee commits to anything.
   *
   * POST rather than GET /invitations/:token: a token in a path ends up in
   * access logs and proxy logs, and it is a credential until it is used.
   */
  @Post('invitations/preview')
  @Public()
  @HttpCode(200)
  previewInvitation(@ZodBody(invitationTokenSchema) input: { token: string }) {
    return this.users.previewInvitation(input.token);
  }

  /** Accept, and land signed in to the company that invited you. */
  @Post('invitations/accept')
  @Public()
  @HttpCode(200)
  async acceptInvitation(@ZodBody(acceptInvitationSchema) input: { token: string; password: string }) {
    const { email, tenantId } = await this.users.acceptInvitation(input.token, input.password);
    return this.auth.login(email, input.password, tenantId);
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

  /**
   * Who am I, where am I, and what may I do? The web app boots from this.
   *
   * `tenants` is every company the user may switch to (D-16), so the switcher
   * can render on any page load, not only straight after login.
   */
  @Get('me')
  @SkipMfa()
  async me(@Req() req: AuthedRequest) {
    const actor = actorOrThrow(req);
    return {
      userId: actor.userId,
      tenantId: actor.tenantId,
      employeeId: actor.employeeId,
      mfaVerified: actor.mfaVerified,
      permissions: [...actor.permissions],
      tenants: await this.auth.listTenants(actor.userId),
    };
  }
}
