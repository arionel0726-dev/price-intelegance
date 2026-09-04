export type ParsedVizajeVariant = {
  sku: string;
  volume: string | null;
  color: string | null;
  regular_price: number | null;
  price: number | null;
  available: boolean;
  image_url: string | null;
};

export type ParsedVizajeFamily = {
  external_id: string;
  title: string;
  brand: string | null;
  category: string | null;
  sex: string | null;
  canonical_url: string;
  image_url: string | null;
  variants: ParsedVizajeVariant[];
};

export type VizajeBatchFailure = {
  external_id: string | null;
  url: string;
  error: string;
};

export type VizajeBatchResult = {
  discovered: number;
  attempted: number;
  succeeded: number;
  failed: number;
  families: ParsedVizajeFamily[];
  failures: VizajeBatchFailure[];
};
