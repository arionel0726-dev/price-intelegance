import { timingSafeEqual } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export const SESSION_COOKIE_NAME = 'price_session';

export type SessionPayload = {
  sub: 'internal';
  email: string;
};

@Injectable()
export class AuthService {
  private readonly email = process.env.AUTH_EMAIL ?? '';
  private readonly password = process.env.AUTH_PASSWORD ?? '';
  readonly sessionTtlSeconds = Number(process.env.AUTH_SESSION_TTL ?? 86400);

  constructor(private readonly jwtService: JwtService) {}

  login(email: string, password: string): string {
    if (!this.credentialsMatch(email, password)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: SessionPayload = { sub: 'internal', email: this.email };

    return this.jwtService.sign(payload, {
      expiresIn: this.sessionTtlSeconds,
    });
  }

  get configuredEmail(): string {
    return this.email;
  }

  verify(token: string): SessionPayload {
    try {
      return this.jwtService.verify<SessionPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid session');
    }
  }

  private credentialsMatch(email: string, password: string): boolean {
    return this.safeEqual(email, this.email) && this.safeEqual(password, this.password);
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);

    if (bufA.length !== bufB.length) {
      return false;
    }

    return timingSafeEqual(bufA, bufB);
  }
}
