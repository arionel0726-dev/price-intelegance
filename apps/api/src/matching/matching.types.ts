export type VizajeCandidate = {
  id: number;
  brand: string;
  name: string;
  volume: string | null;
  color: string | null;
};

export type CompetitorVariantRow = {
  variantId: number;
  variantExternalId: string;
  label: string | null;
  volume: string | null;
  price: string | null;

  productId: number;
  productExternalId: string;
  productBrand: string | null;
  productTitle: string;

  competitorId: number;
  competitorName: string;
  competitorDomain: string;
};

export type MatchDecision = 'auto' | 'ambiguous' | 'reject';

export type MatchSignals = {
  brandMatched: boolean;
  concentrationVizaje: string | null;
  concentrationCompetitor: string | null;
  concentrationConflict: boolean;
  concentrationAgree: boolean;
  volumeVizaje: string | null;
  volumeCompetitor: string | null;
  volumeConflict: boolean;
  volumeExactMatch: boolean;
  shadeVizaje: string | null;
  shadeCompetitor: string | null;
  shadeConflict: boolean;
  shadeExactMatch: boolean;
  typeVizaje: string | null;
  typeCompetitor: string | null;
  typeConflict: boolean;
  isColorProduct: boolean;
};

export type CandidateEvaluation = {
  vizajeProductId: number;
  vizajeBrand: string;
  vizajeName: string;
  vizajeVolume: string | null;
  vizajeColor: string | null;

  competitorId: number;
  competitorName: string;
  productId: number;
  productExternalId: string;
  productTitle: string;
  variantId: number;
  variantExternalId: string;
  variantLabel: string | null;
  variantVolume: string | null;

  nameSimilarity: number;
  score: number;
  decision: MatchDecision;
  rejectReason: string | null;
  signals: MatchSignals;
};

export type MatchGroupResult = {
  vizajeProductId: number;
  competitorId: number;
  competitorName: string;
  decision: 'auto' | 'ambiguous' | 'no_candidate';
  top: CandidateEvaluation | null;
  secondBest: CandidateEvaluation | null;
  margin: number | null;
};

export type PreviewResult = {
  summary: {
    vizajeProductsScanned: number;
    competitorParentsScanned: number;
    candidatePairsEvaluated: number;
    autoCount: number;
    ambiguousCount: number;
    noMatchCount: number;
  };
  auto: MatchGroupResult[];
  ambiguous: MatchGroupResult[];
};

export type PersistAutoOptions = {
  // Competitor name (e.g. "MAKEUP", "OVICO"), case-insensitive. Omit to
  // process all real (non-demo) competitors.
  competitor?: string;
};

export type PersistAutoResult = {
  evaluatedCompetitors: number;
  autoCandidates: number;
  inserted: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  skippedManual: number;
};
