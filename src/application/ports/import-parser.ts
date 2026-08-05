import type { ImportSourceType } from '@/domain/route';

export type ParsedStopCandidate = {
  orderNumber: string | null;
  recipient: string;
  address: string;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  weightKg: number | null;
  phone: string | null;
  notes: string | null;
  confidenceByField?: Partial<Record<keyof Omit<ParsedStopCandidate, 'confidenceByField'>, number>>;
};

export type ImportInput = {
  type: ImportSourceType;
  originalText?: string;
  imageReference?: string;
};

/**
 * Integracijos riba. MVP naudos deterministinį įklijuoto teksto skaidymą.
 * OCR ar LLM adapteris vėliau įgyvendins tą pačią sąsają.
 */
export interface ImportParser {
  parse(input: ImportInput): Promise<ParsedStopCandidate[]>;
}
