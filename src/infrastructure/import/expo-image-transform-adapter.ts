import type { ImageTransformAdapter } from '@/application/import/image-preprocessing';
import type { PreprocessingOperation } from '@/domain/import/models';

export class ExpoImageTransformAdapter implements ImageTransformAdapter {
  supports(_operation: PreprocessingOperation): boolean {
    // Expo ImageManipulator does not provide reliable document edge, perspective,
    // denoise or auto-orientation detection. The OCR provider performs these steps
    // until a native document-scanner adapter is linked.
    return false;
  }

  async transform(uri: string): Promise<string> {
    return uri;
  }
}
