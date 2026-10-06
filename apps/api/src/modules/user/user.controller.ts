import {
  Controller, Get, Post, Delete, Param, Req, HttpCode, ParseUUIDPipe,
} from '@nestjs/common';
import { inviteUserSchema, type InviteUserInput } from '@peoplepulse/core';
import { RequirePermission } from '../../platform/rbac/require-permission.decorator';
import { actorOrThrow } from '../../platform/rbac/permission.guard';
import { ZodBody } from '../../platform/validation/zod.pipe';
import { UserService } from './user.service';
import type { AuthedRequest } from '../../platform/auth/authed-request';

/**
 * Inviting people into the active company (D-16).
 *
 * Every route here needs `user.invite`, reads included. `user.manage` would be
 * the obvious gate for the list, but it requires MFA (NFR-04) and nobody can
 * enrol in MFA yet; and whoever adds people needs to see who is already here
 * and what is outstanding. Removing someone's access is `user.manage`'s, and
 * waits for MFA.
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
}
