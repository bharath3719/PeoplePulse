import {
  Controller, Get, Post, Put, Delete, Param, Req, HttpCode, ParseUUIDPipe,
} from '@nestjs/common';
import {
  inviteUserSchema, updateMemberRolesSchema, type InviteUserInput, type UpdateMemberRolesInput,
} from '@peoplepulse/core';
import { RequirePermission } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody } from '../../platform/validation/zod.pipe';
import { UserService } from './user.service';
import type { AuthedRequest } from '../../platform/auth/authed-request';

/**
 * Who can sign in to the active company (D-16): inviting people in, changing
 * what they can do, and taking it away.
 *
 * Inviting, and the list, need `user.invite` — whoever adds people needs to see
 * who is already here and what is outstanding. Changing or ending someone's
 * access needs `user.manage`, which requires a verified second factor (NFR-04);
 * the guard enforces that from the permission, so nothing here mentions it.
 *
 * Accepting is public and lives under /auth, beside login and signup.
 */
@Controller('users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get()
  @RequirePermission('user.invite')
  list(@Req() req: AuthedRequest) {
    return this.users.listAccess(actorOrThrow(req));
  }

  /** Only the roles the caller holds every permission of — see canGrant(). */
  @Get('grantable-roles')
  @RequirePermission('user.invite')
  grantableRoles(@Req() req: AuthedRequest) {
    return this.users.grantableRoles(actorOrThrow(req));
  }

  @Post('invitations')
  @RequirePermission('user.invite')
  invite(@Req() req: AuthedRequest, @ZodBody(inviteUserSchema) input: InviteUserInput) {
    return this.users.invite(actorOrThrow(req), input);
  }

  @Delete('invitations/:id')
  @RequirePermission('user.invite')
  @HttpCode(204)
  async revoke(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.revokeInvitation(actorOrThrow(req), id);
  }

  /** PUT: the body is the whole set of roles they will hold, not a change to it. */
  @Put(':userId/roles')
  @RequirePermission('user.manage')
  @HttpCode(204)
  async updateRoles(
    @Req() req: AuthedRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @ZodBody(updateMemberRolesSchema) input: UpdateMemberRolesInput,
  ) {
    await this.users.updateRoles(actorOrThrow(req), userId, input);
  }

  /** Ends the membership, not the login: it may serve other companies. */
  @Delete(':userId')
  @RequirePermission('user.manage')
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.users.remove(actorOrThrow(req), userId);
  }

  /** For a lost phone. They set up a new authenticator at their next sign-in. */
  @Delete(':userId/mfa')
  @RequirePermission('user.manage')
  @HttpCode(204)
  async resetMfa(@Req() req: AuthedRequest, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.users.resetMfa(actorOrThrow(req), userId);
  }
}
