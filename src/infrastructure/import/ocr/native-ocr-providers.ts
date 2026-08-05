import type { ImportDocument, OcrProviderId, OcrResult } from '@/domain/import/models';
import { OcrUnavailableError, type OcrProvider, type OcrProviderCapabilities } from '@/application/import/ocr-provider';

export type NativeOcrRunner = (document: ImportDocument, signal?: AbortSignal) => Promise<OcrResult>;

abstract class NativeOcrProvider implements OcrProvider {
  abstract readonly id: OcrProviderId;
  abstract readonly version: string;
  abstract readonly capabilities: OcrProviderCapabilities;

  constructor(private readonly runner?: NativeOcrRunner) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.runner);
  }

  async recognize(document: ImportDocument, signal?: AbortSignal): Promise<OcrResult> {
    if (!this.runner) {
      throw new OcrUnavailableError(
        this.id,
        `${this.id} native modulis neįdiegtas šiame aplikacijos build'e.`,
      );
    }
    return this.runner(document, signal);
  }
}

export class AppleVisionOcrProvider extends NativeOcrProvider {
  readonly id = 'apple-vision' as const;
  readonly version = 'apple-vision-adapter-v1';
  readonly capabilities = { images: true, pdf: false, multiPage: false, offline: true };
}

export class TesseractOcrProvider extends NativeOcrProvider {
  readonly id = 'tesseract' as const;
  readonly version = 'tesseract-adapter-v1';
  readonly capabilities = { images: true, pdf: true, multiPage: true, offline: true };
}
