import {
  Injectable, CanActivate, ExecutionContext, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PUBLIC_KEY } from '../rbac/require-permission.decorator';
import { AuthService } from './auth.service';
import type { AuthedRequest, JwtPayload } from './authed-request';

/**
 * Authentication: proves WHO the caller is and attaches the Actor.
 * Authorization (WHAT they may do) is PermissionGuard's job, and runs after.
 *
 * Registered globally, so every route is protected unless it is explicitly
 * @Public. Forgetting to annotate a new route therefore fails CLOSED — a 401 —
 * rather than quietly exposing it. That default is the whole point: the failure
 * mode of forgetfulness must be inconvenient, not catastrophic.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractBearer(request.headers.authorization);
    if (!token) throw new UnauthorizedException();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException();
    }

    // A refresh token must never open a door. It is a long-lived credential
    // (30 days) held for one purpose: minting access tokens.
    if (payload.typ !== 'access') throw new UnauthorizedException();

    request.actor = await this.auth.resolveActor(payload);
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
