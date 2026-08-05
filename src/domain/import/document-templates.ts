import type { DocumentTemplateId } from './models';

export type DocumentTemplate = {
  id: DocumentTemplateId;
  label: string;
  orderNumberLabels: string[];
  recipientLabels: string[];
  notesLabels: string[];
};

const GENERIC: DocumentTemplate = {
  id: 'generic',
  label: 'Bendras dokumentas',
  orderNumberLabels: ['užsakymas', 'užsakymo nr', 'order', 'siuntos nr'],
  recipientLabels: ['gavėjas', 'klientas', 'recipient'],
  notesLabels: ['pastabos', 'komentaras', 'notes'],
};

export const DOCUMENT_TEMPLATES: Record<DocumentTemplateId, DocumentTemplate> = {
  generic: GENERIC,
  dpd: { ...GENERIC, id: 'dpd', label: 'DPD' },
  dhl: { ...GENERIC, id: 'dhl', label: 'DHL' },
  raben: { ...GENERIC, id: 'raben', label: 'Raben' },
  'excel-export': { ...GENERIC, id: 'excel-export', label: 'Vidinis Excel eksportas' },
  'logistics-excel-v1': { ...GENERIC, id: 'logistics-excel-v1', label: 'Logistikos Excel v1' },
};
