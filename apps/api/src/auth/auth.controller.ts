import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService, SESSION_COOKIE_NAME } from './auth.service';
import { Public } from './public.decorator';

class LoginBody {
  email!: string;
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(
    @Body() body: LoginBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.authService.login(body.email ?? '', body.password ?? '');

    res.cookie(SESSION_COOKIE_NAME, token, this.cookieOptions());

    return { authenticated: true, email: this.authService.configuredEmail };
  }

  // Public: a stale/expired session should still be able to hit logout and
  // clear its cookie instead of getting bounced with a 401.
  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });

    return { authenticated: false };
  }

  // Protected by the global AuthGuard - reaching this handler already proves
  // the session cookie is valid.
  @Get('me')
  me(@Req() req: Request) {
    const session = (req as Request & { session?: { email: string } }).session;

    return { authenticated: true, email: session?.email };
  }

  private cookieOptions() {
    const ttlSeconds = Number(process.env.AUTH_SESSION_TTL ?? 86400);

    // TEMPORARY: lets a production deployment served over plain HTTP (e.g.
    // by bare VPS IP, before a domain/TLS cert is in place) still persist
    // the session cookie - browsers drop Secure cookies over HTTP. Default
    // (unset, or anything other than the literal string "false") preserves
    // the normal secure=true-in-production behavior; only an explicit
    // AUTH_COOKIE_SECURE=false disables it.
    const secure =
      process.env.AUTH_COOKIE_SECURE === 'false'
        ? false
        : process.env.NODE_ENV === 'production';

    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure,
      maxAge: ttlSeconds * 1000,
    };
  }
}
