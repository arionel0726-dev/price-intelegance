import { Body, Controller, Post } from '@nestjs/common';

import { MatchingService } from './matching.service';

class PreviewBody {
  // Optional allowlist of competitor domains (e.g. ["makeup.md"]) to exclude
  // demo/seed competitors (Brocard, Aroma) from calibration runs.
  competitorDomains?: string[];
}

class PersistAutoBody {
  // Competitor name (e.g. "MAKEUP", "OVICO"). Omit to process all real
  // (non-demo) competitors.
  competitor?: string;
}

@Controller('matching')
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  // Dry-run only - does not write to `matches`.
  @Post('preview')
  preview(@Body() body: PreviewBody) {
    return this.matchingService.preview({
      competitorDomains: body.competitorDomains,
    });
  }

  // Writes only groups the matcher classifies as 'auto'. Ambiguous/rejected
  // candidates are never persisted here.
  @Post('persist-auto')
  persistAuto(@Body() body: PersistAutoBody) {
    return this.matchingService.persistAuto({
      competitor: body.competitor,
    });
  }
}
