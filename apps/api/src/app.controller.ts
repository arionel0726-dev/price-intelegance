import { Controller, Get } from '@nestjs/common';

import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  // Unauthenticated on purpose - this is what Docker healthchecks and
  // load balancers probe; it must not depend on a valid session cookie.
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
