export type ParsedVariant = {
  external_id: string | null;
  label: string | null;
  volume: string | null;
  price: number | null;
  available: boolean;
};

export type ParsedProduct = {
  competitor: string;
  external_id: string | null;
  title: string;
  brand: string | null;
  currency: string;
  barcode: string | null;
  image_url: string | null;
  url: string;
  variants: ParsedVariant[];
};

export type BatchParseFailure = {
  external_id: string | null;
  url: string;
  error: string;
};

export type BatchParseResult = {
  competitor: string;
  discovered: number;
  attempted: number;
  succeeded: number;
  failed: number;
  products: ParsedProduct[];
  failures: BatchParseFailure[];
};

export type SearchResultItem = {
  external_id: string;
  title: string;
  brand: string | null;
  url: string;
  image_url: string | null;
};

export type SearchResponse = {
  query: string;
  results: SearchResultItem[];
};

export type SearchBatchResponse = {
  results: SearchResponse[];
};
