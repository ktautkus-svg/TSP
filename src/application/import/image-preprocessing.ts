import type { ImportDocument, PreprocessingOperation, PreprocessingStepResult } from '@/domain/import/models';

export type ImageTransformAdapter = {
  supports(operation: PreprocessingOperation): boolean;
  transform(uri: string, operation: PreprocessingOperation): Promise<string>;
};

export class ImagePreprocessingPipeline {
  constructor(
    private readonly adapter: ImageTransformAdapter,
    private readonly operations: PreprocessingOperation[] = [
      'auto-rotate', 'edge-detection', 'perspective-correction', 'contrast', 'denoise',
    ],
  ) {}

  async process(document: ImportDocument): Promise<{ document: ImportDocument; steps: PreprocessingStepResult[] }> {
    if (!document.uri || document.kind === 'clipboard' || document.kind === 'text') {
      return { document, steps: [] };
    }
    let uri = document.uri;
    const steps: PreprocessingStepResult[] = [];
    for (const operation of this.operations) {
      const started = performance.now();
      if (!this.adapter.supports(operation)) {
        steps.push({
          operation,
          status: 'delegated',
          inputUri: uri,
          outputUri: uri,
          durationMs: performance.now() - started,
          warning: `${operation} perduodamas OCR tiekėjui arba native dokumentų skeneriui.`,
        });
        continue;
      }
      const outputUri = await this.adapter.transform(uri, operation);
      steps.push({ operation, status: 'applied', inputUri: uri, outputUri, durationMs: performance.now() - started, warning: null });
      uri = outputUri;
    }
    return { document: { ...document, uri }, steps };
  }
}
