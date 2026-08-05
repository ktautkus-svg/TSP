import type { Confidence, ImportQuality, ParsedDelivery } from './models';

export function clampConfidence(value: number): Confidence {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function meanConfidence(values: number[], fallback = 0): Confidence {
  if (values.length === 0) return clampConfidence(fallback);
  return clampConfidence(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function calculateImportQuality(
  ocrConfidence: number,
  deliveries: ParsedDelivery[],
): ImportQuality {
  const parserConfidence = meanConfidence(deliveries.map((item) => item.parserConfidence));
  const addressConfidence = meanConfidence(deliveries.map((item) => item.addressConfidence));
  const importConfidence = meanConfidence(deliveries.map((item) => item.importConfidence));
  return {
    ocrConfidence: clampConfidence(ocrConfidence),
    parserConfidence,
    addressConfidence,
    importConfidence,
    overallConfidence: clampConfidence(
      ocrConfidence * 0.25 + parserConfidence * 0.3 + addressConfidence * 0.3 + importConfidence * 0.15,
    ),
  };
}

export function confidenceLevel(value: Confidence): 'high' | 'warning' | 'danger' {
  if (value < 0.4) return 'danger';
  if (value < 0.7) return 'warning';
  return 'high';
}
