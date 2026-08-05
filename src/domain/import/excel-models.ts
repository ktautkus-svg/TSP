export const LOGISTICS_EXCEL_TEMPLATE_ID = 'LOGISTICS_EXCEL_V1' as const;

export type ExcelCellValue = string | number | boolean | null;

export type LogisticsExcelTemplate = {
  id: typeof LOGISTICS_EXCEL_TEMPLATE_ID;
  version: '1.0.0';
  label: string;
  columns: {
    orderNumber: string;
    weightKg: string;
    deliveryTime: string;
    companyOrSupplier: string;
    deliveryAddress: string;
    recipient: string | null;
    routeCode: string | null;
  };
  defaultCity: string;
  defaultCountry: string;
  supplierPrefixes: string[];
};

export const LOGISTICS_EXCEL_V1: LogisticsExcelTemplate = {
  id: LOGISTICS_EXCEL_TEMPLATE_ID,
  version: '1.0.0',
  label: 'Logistikos maršruto Excel v1',
  columns: {
    orderNumber: 'A',
    weightKg: 'B',
    deliveryTime: 'C',
    companyOrSupplier: 'D',
    deliveryAddress: 'E',
    recipient: 'F',
    routeCode: 'G',
  },
  defaultCity: 'Šiauliai',
  defaultCountry: 'Lietuva',
  supplierPrefixes: ['UAB Lambda LT', 'Lambda', 'UAB Galiasas', 'Galiasas'],
};

export type ExcelImportIssueCode =
  | 'COLUMN_MAPPING_REQUIRED'
  | 'ADDRESS_MISSING'
  | 'ADDRESS_SOURCE_CONFLICT'
  | 'INVALID_WEIGHT'
  | 'NEGATIVE_WEIGHT'
  | 'INVALID_TIME_WINDOW'
  | 'TIME_WINDOW_CONFLICT'
  | 'DUPLICATE_ORDER_NUMBER';

export type ExcelColumnMapping = LogisticsExcelTemplate['columns'];

export type ExcelWorkbookSheet = {
  name: string;
  rowCount: number;
  score: number;
  selected: boolean;
};

export type ExcelSourceRow = {
  id: string;
  sourceImportId: string;
  sourceSheetName: string;
  sourceRowNumber: number;
  orderNumber: string | null;
  weightGrams: number | null;
  weightRaw: string | null;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  deliveryTimeRaw: string | null;
  supplierPrefix: string | null;
  recipient: string | null;
  routeCode: string | null;
  rawColumnD: string | null;
  rawColumnE: string | null;
  rawRow: Record<string, ExcelCellValue>;
  originalAddress: string | null;
  normalizedAddress: string | null;
  alternateAddress: string | null;
  manualGroupKey: string | null;
  issueCodes: ExcelImportIssueCode[];
  excluded: boolean;
};

export type ExcelDeliveryGroup = {
  id: string;
  normalizedAddressKey: string;
  originalAddress: string;
  normalizedAddress: string;
  lineIds: string[];
  orderNumbers: string[];
  recipients: string[];
  totalWeightGrams: number;
  knownWeightLineCount: number;
  unknownWeightLineCount: number;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  issueCodes: ExcelImportIssueCode[];
  conflictingLineIds: string[];
};

export type ExcelImportSummary = {
  sourceRowCount: number;
  includedRowCount: number;
  uniqueOrderCount: number;
  physicalStopCount: number;
  totalWeightGrams: number;
  unknownWeightLineCount: number;
  routeCodes: string[];
  unconfirmedAddressCount: number;
  timeWindowConflictCount: number;
  possibleDuplicateCount: number;
};

export type ExcelImportPreview = {
  id: string;
  fileName: string;
  fileHash: string;
  templateId: typeof LOGISTICS_EXCEL_TEMPLATE_ID;
  templateVersion: string;
  sheets: ExcelWorkbookSheet[];
  selectedSheetName: string;
  firstDataRow: number;
  mapping: ExcelColumnMapping;
  mappingRecognized: boolean;
  selectedRouteCodes: string[];
  rows: ExcelSourceRow[];
  groups: ExcelDeliveryGroup[];
  summary: ExcelImportSummary;
  createdAt: string;
};

export type ExcelImportCorrection = {
  id: string;
  importSessionId: string;
  targetType: 'row' | 'group';
  targetId: string;
  field: string;
  previousValue: unknown;
  correctedValue: unknown;
  createdAt: string;
};
