export type ShipmentLine = {
  id: string;
  routeId: string;
  deliveryStopId: string;
  sourceImportId: string;
  sourceSheetName: string;
  sourceRowNumber: number;
  orderNumber: string | null;
  weightGrams: number | null;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  supplierPrefix: string | null;
  recipient: string | null;
  routeCode: string | null;
  rawColumnD: string | null;
  rawColumnE: string | null;
  rawRow: Record<string, string | number | boolean | null>;
  createdAt: string;
};

export type DraftShipmentLineInput = Omit<
  ShipmentLine,
  'id' | 'routeId' | 'deliveryStopId' | 'createdAt'
>;

export function shipmentLineWeightKg(line: Pick<ShipmentLine, 'weightGrams'>): number | null {
  return line.weightGrams === null ? null : line.weightGrams / 1000;
}
