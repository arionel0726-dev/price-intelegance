import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { normalizeBarcode } from '@price/db';

import {
  canonicalBrand,
  nameSimilarity,
  normalizeName,
  normalizeVolume,
  volumesMatch,
} from '../matching/matching-normalization';

type JobVnRow = {
  ID_nom: number;
  Barcode: string | null;
  Brand: string | null;
  ShortDescriptionRus: string | null;
  VariativeName: string | null;
  WarehouseName: string | null;
  VolumeVar: string | null;
  ColorVar: string | null;
};

export type WebsiteIdentity = {
  brand: string | null;
  name: string;
  volume: string | null;
  color: string | null;
};

export type BarcodeResolution =
  | { status: 'none' }
  | { status: 'unambiguous' | 'resolved'; barcode: string | null; allBarcodes: string[] }
  | { status: 'ambiguous'; candidateGroups: number };

// JobVN.json is now ONLY used to enrich barcode by ID_nom/sku - it is no
// longer the master catalog source (the Vizaje website is). This is a
// bootstrap dependency we intend to retire once existing products already
// carry good barcode data (see products.barcode / product_barcodes).
@Injectable()
export class VizajeBarcodeLookupService {
  private readonly logger = new Logger(VizajeBarcodeLookupService.name);
  private byId: Map<number, JobVnRow[]> | null = null;

  private ensureLoaded(): Map<number, JobVnRow[]> {
    if (this.byId) return this.byId;

    const jsonPath =
      process.env.VIZAJE_JSON_PATH ??
      path.resolve(__dirname, '../../../../data/vizaje/JobVN.json');

    this.logger.log(`Loading JobVN barcode lookup from ${jsonPath}`);

    const raw = readFileSync(jsonPath, 'utf-8');
    const rows: JobVnRow[] = JSON.parse(raw);

    const byId = new Map<number, JobVnRow[]>();
    for (const row of rows) {
      const list = byId.get(row.ID_nom);
      if (list) list.push(row);
      else byId.set(row.ID_nom, [row]);
    }

    this.byId = byId;
    this.logger.log(`Loaded ${rows.length} JobVN rows (${byId.size} distinct ID_nom)`);

    return byId;
  }

  resolve(sku: string, website: WebsiteIdentity): BarcodeResolution {
    const idNom = Number(sku);
    if (!Number.isFinite(idNom)) return { status: 'none' };

    const rows = this.ensureLoaded().get(idNom);
    if (!rows || rows.length === 0) return { status: 'none' };

    if (rows.length === 1) {
      return this.toResolution('unambiguous', rows);
    }

    const groups = this.groupByIdentity(rows);

    if (groups.length === 1) {
      // Same underlying SKU, legitimately multiple barcodes (e.g.
      // repackaging) - no disambiguation needed, use all of them.
      return this.toResolution('unambiguous', groups[0]!.rows);
    }

    // Genuinely different identities sharing one raw ID_nom (a known JobVN
    // data-quality issue) - only resolve if the website variant's own
    // brand/name/volume/color clearly points to exactly one group.
    const scored = groups
      .map(group => ({ group, score: this.scoreGroup(group.rows[0]!, website) }))
      .filter((entry): entry is { group: (typeof groups)[number]; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score);

    const top = scored[0];
    const second = scored[1];

    if (top && top.score >= 0.3 && (!second || top.score - second.score >= 0.15)) {
      return this.toResolution('resolved', top.group.rows);
    }

    return { status: 'ambiguous', candidateGroups: groups.length };
  }

  private toResolution(
    status: 'unambiguous' | 'resolved',
    rows: JobVnRow[],
  ): BarcodeResolution {
    const barcodes = [
      ...new Set(
        rows
          .map(r => normalizeBarcode(r.Barcode).value)
          .filter((v): v is string => v !== null),
      ),
    ];

    return { status, barcode: barcodes[0] ?? null, allBarcodes: barcodes };
  }

  // Buckets raw rows sharing one ID_nom by normalized identity
  // (brand/name/volume/color) - rows in the same bucket are treated as the
  // same SKU with multiple barcodes; different buckets are treated as
  // genuinely different products colliding on ID_nom.
  private groupByIdentity(rows: JobVnRow[]): { key: string; rows: JobVnRow[] }[] {
    const groups = new Map<string, JobVnRow[]>();

    for (const row of rows) {
      const key = [
        canonicalBrand(row.Brand),
        normalizeName(this.bestName(row)),
        (row.VolumeVar ?? '').trim().toLowerCase(),
        (row.ColorVar ?? '').trim().toLowerCase(),
      ].join('|');

      const list = groups.get(key);
      if (list) list.push(row);
      else groups.set(key, [row]);
    }

    return [...groups.entries()].map(([key, groupRows]) => ({ key, rows: groupRows }));
  }

  private bestName(row: JobVnRow): string {
    return row.VariativeName || row.ShortDescriptionRus || row.WarehouseName || '';
  }

  // Returns null when the candidate is clearly disqualified (brand or
  // volume/color conflict); otherwise a 0..~2 score combining name
  // similarity with small bonuses for matching volume/color.
  private scoreGroup(row: JobVnRow, website: WebsiteIdentity): number | null {
    if (!website.brand) return null;
    if (canonicalBrand(row.Brand) !== canonicalBrand(website.brand)) return null;

    const rowVolume = normalizeVolume(row.VolumeVar);
    const webVolume = normalizeVolume(website.volume);
    if (rowVolume && webVolume && !volumesMatch(rowVolume, webVolume)) return null;

    const rowColor = (row.ColorVar ?? '').trim();
    const webColor = (website.color ?? '').trim();
    if (rowColor && webColor && rowColor !== webColor) return null;

    let score = nameSimilarity(normalizeName(this.bestName(row)), normalizeName(website.name));

    if (rowVolume && webVolume && volumesMatch(rowVolume, webVolume)) score += 0.5;
    if (rowColor && webColor && rowColor === webColor) score += 0.5;

    return score;
  }
}
