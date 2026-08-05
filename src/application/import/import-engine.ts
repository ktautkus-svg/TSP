import { resolveDeliveryAddresses, type AddressLookupProvider } from './address-resolver';
import { parseDeliveries } from './delivery-parser';
import { ImagePreprocessingPipeline } from './image-preprocessing';
import type { OcrProvider } from './ocr-provider';
import { calculateImportQuality } from '@/domain/import/confidence';
import { detectDuplicates } from '@/domain/import/duplicate-detector';
import type { DocumentTemplateId, ImportAuditRecord, ImportDocument, ImportResult } from '@/domain/import/models';

export interface ImportAuditRepository {
  save(record: ImportAuditRecord): Promise<void>;
}

export class ImportEngine {
  constructor(
    private readonly preprocessor: ImagePreprocessingPipeline,
    private readonly ocrProvider: OcrProvider,
    private readonly addressProvider: AddressLookupProvider,
    private readonly auditRepository: ImportAuditRepository,
  ) {}

  async import(document: ImportDocument, template: DocumentTemplateId = 'generic'): Promise<ImportResult> {
    const { document: prepared, steps } = await this.preprocessor.process(document);
    const ocr = await this.ocrProvider.recognize(prepared);
    const parsed = parseDeliveries(ocr.text, template);
    const deliveries = await resolveDeliveryAddresses(parsed, this.addressProvider);
    const duplicates = detectDuplicates(deliveries);
    const quality = calculateImportQuality(ocr.confidence, deliveries);
    const auditId = `import-${document.id}`;
    const requiresReview =
      deliveries.some((item) => item.validationState !== 'valid') ||
      duplicates.length > 0;
    await this.auditRepository.save({
      id: auditId,
      document,
      originalFileUri: document.uri,
      preprocessing: steps,
      ocr,
      deliveries,
      duplicates,
      corrections: [],
      finalRouteId: null,
      quality,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    return { auditId, document, ocr, deliveries, duplicates, quality, requiresReview };
  }
}
