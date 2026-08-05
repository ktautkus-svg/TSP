export type Confidence = number;

export type ImportSourceKind = 'camera' | 'gallery' | 'pdf' | 'clipboard' | 'text' | 'excel';
export type DocumentTemplateId = 'generic' | 'dpd' | 'dhl' | 'raben' | 'excel-export' | 'logistics-excel-v1';
export type OcrProviderId = 'mock' | 'google-vision' | 'apple-vision' | 'tesseract';

export type ImportField<T> = {
  value: T | null;
  confidence: Confidence;
  evidence: string | null;
  manuallyCorrected: boolean;
};

export type ImportDocument = {
  id: string;
  kind: ImportSourceKind;
  uri: string | null;
  pageUris?: string[];
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  pageCount: number;
  createdAt: string;
  pastedText?: string;
};

export type PreprocessingOperation =
  | 'auto-rotate'
  | 'perspective-correction'
  | 'contrast'
  | 'denoise'
  | 'edge-detection'
  | 'page-merge';

export type PreprocessingStepResult = {
  operation: PreprocessingOperation;
  status: 'applied' | 'delegated' | 'skipped' | 'unavailable';
  inputUri: string | null;
  outputUri: string | null;
  durationMs: number;
  warning: string | null;
};

export type OcrBlock = {
  id: string;
  text: string;
  confidence: Confidence;
  page: number;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
};

export type OcrResult = {
  provider: OcrProviderId;
  providerVersion: string;
  text: string;
  confidence: Confidence;
  blocks: OcrBlock[];
  pageCount: number;
  processingMs: number;
  warnings: string[];
};

export type ResolvedAddressCandidate = {
  normalizedAddress: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
  confidence: Confidence;
};

export type ParsedDelivery = {
  id: string;
  sourcePage: number | null;
  rawText: string;
  address: ImportField<string>;
  /** Exact normalized query sent to the address provider; original OCR text remains in address. */
  addressQuery: string | null;
  orderNumber: ImportField<string>;
  weightKg: ImportField<number>;
  deliveryTime: ImportField<string>;
  phone: ImportField<string>;
  recipient: ImportField<string>;
  notes: ImportField<string>;
  parserConfidence: Confidence;
  addressConfidence: Confidence;
  importConfidence: Confidence;
  addressCandidates: ResolvedAddressCandidate[];
  selectedAddress: ResolvedAddressCandidate | null;
  validationState: 'pending' | 'valid' | 'ambiguous' | 'invalid';
};

export type DuplicateReason = 'same-order-number' | 'same-address' | 'similar-address';

export type DuplicateFinding = {
  id: string;
  leftDeliveryId: string;
  rightDeliveryId: string;
  reason: DuplicateReason;
  similarity: Confidence;
  recommendation: 'merge' | 'review';
};

export type ImportQuality = {
  ocrConfidence: Confidence;
  parserConfidence: Confidence;
  addressConfidence: Confidence;
  importConfidence: Confidence;
  overallConfidence: Confidence;
};

export type ManualCorrection = {
  id: string;
  deliveryId: string;
  field: keyof Pick<ParsedDelivery, 'address' | 'orderNumber' | 'weightKg' | 'deliveryTime' | 'phone' | 'recipient' | 'notes'>;
  previousValue: string | number | null;
  correctedValue: string | number | null;
  createdAt: string;
};

export type ImportAuditRecord = {
  id: string;
  document: ImportDocument;
  originalFileUri: string | null;
  preprocessing: PreprocessingStepResult[];
  ocr: OcrResult;
  deliveries: ParsedDelivery[];
  duplicates: DuplicateFinding[];
  corrections: ManualCorrection[];
  finalRouteId: string | null;
  quality: ImportQuality;
  createdAt: string;
  completedAt: string | null;
};

export type ImportResult = {
  auditId: string;
  document: ImportDocument;
  ocr: OcrResult;
  deliveries: ParsedDelivery[];
  duplicates: DuplicateFinding[];
  quality: ImportQuality;
  requiresReview: boolean;
};
