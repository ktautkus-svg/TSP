import type { SQLiteDatabase } from 'expo-sqlite';

import type { ShipmentLine } from '@/domain/shipment-line';

type ShipmentLineRow = {
  id: string;
  route_id: string;
  delivery_stop_id: string;
  source_import_id: string;
  source_sheet_name: string;
  source_row_number: number;
  order_number: string | null;
  weight_grams: number | null;
  delivery_time_from: string | null;
  delivery_time_to: string | null;
  supplier_prefix: string | null;
  recipient: string | null;
  route_code: string | null;
  raw_column_d: string | null;
  raw_column_e: string | null;
  raw_row_json: string;
  created_at: string;
};

export class ShipmentLineRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getByStop(deliveryStopId: string): Promise<ShipmentLine[]> {
    const rows = await this.db.getAllAsync<ShipmentLineRow>(
      'SELECT * FROM shipment_lines WHERE delivery_stop_id = ? ORDER BY source_row_number, id',
      deliveryStopId,
    );
    return rows.map(mapShipmentLine);
  }

  async getByRoute(routeId: string): Promise<ShipmentLine[]> {
    const rows = await this.db.getAllAsync<ShipmentLineRow>(
      'SELECT * FROM shipment_lines WHERE route_id = ? ORDER BY delivery_stop_id, source_row_number, id',
      routeId,
    );
    return rows.map(mapShipmentLine);
  }

  async getGroupedByStop(routeId: string): Promise<Map<string, ShipmentLine[]>> {
    const grouped = new Map<string, ShipmentLine[]>();
    for (const line of await this.getByRoute(routeId)) {
      const bucket = grouped.get(line.deliveryStopId) ?? [];
      bucket.push(line);
      grouped.set(line.deliveryStopId, bucket);
    }
    return grouped;
  }
}

function mapShipmentLine(row: ShipmentLineRow): ShipmentLine {
  return {
    id: row.id,
    routeId: row.route_id,
    deliveryStopId: row.delivery_stop_id,
    sourceImportId: row.source_import_id,
    sourceSheetName: row.source_sheet_name,
    sourceRowNumber: row.source_row_number,
    orderNumber: row.order_number,
    weightGrams: row.weight_grams,
    deliveryTimeFrom: row.delivery_time_from,
    deliveryTimeTo: row.delivery_time_to,
    supplierPrefix: row.supplier_prefix,
    recipient: row.recipient,
    routeCode: row.route_code,
    rawColumnD: row.raw_column_d,
    rawColumnE: row.raw_column_e,
    rawRow: JSON.parse(row.raw_row_json) as ShipmentLine['rawRow'],
    createdAt: row.created_at,
  };
}
