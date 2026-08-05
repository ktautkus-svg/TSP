import type { ImportDocument, OcrProviderId, OcrResult } from '@/domain/import/models';

export type OcrProviderCapabilities = {
  images: boolean;
  pdf: boolean;
  multiPage: boolean;
  offline: boolean;
};

export interface OcrProvider {
  readonly id: OcrProviderId;
  readonly version: string;
  readonly capabilities: OcrProviderCapabilities;
  isAvailable(): Promise<boolean>;
  recognize(document: ImportDocument, signal?: AbortSignal): Promise<OcrResult>;
}

export class OcrUnavailableError extends Error {
  constructor(readonly provider: OcrProviderId, message: string) {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}
