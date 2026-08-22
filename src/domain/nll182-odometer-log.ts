export type VehicleDayOdometer = {
  date: string;
  startOdometer: number;
  endOdometer: number;
};

/** Handelshus GPS kelionės lapas NLL182, 2026-08-01 – 2026-08-22. Kuro pylimų čia nėra. */
export const NLL182_ODOMETER_LOG: readonly VehicleDayOdometer[] = [
  { date: '2026-08-01', startOdometer: 274885, endOdometer: 274885 },
  { date: '2026-08-02', startOdometer: 274885, endOdometer: 274885 },
  { date: '2026-08-03', startOdometer: 274885, endOdometer: 274885 },
  { date: '2026-08-04', startOdometer: 274885, endOdometer: 274885 },
  { date: '2026-08-05', startOdometer: 274885, endOdometer: 274885 },
  { date: '2026-08-06', startOdometer: 274885, endOdometer: 274885 },
  { date: '2026-08-07', startOdometer: 274885, endOdometer: 275524 },
  { date: '2026-08-08', startOdometer: 275524, endOdometer: 275751 },
  { date: '2026-08-09', startOdometer: 275751, endOdometer: 275751 },
  { date: '2026-08-10', startOdometer: 275751, endOdometer: 276439 },
  { date: '2026-08-11', startOdometer: 276439, endOdometer: 276439 },
  { date: '2026-08-12', startOdometer: 276439, endOdometer: 276439 },
  { date: '2026-08-13', startOdometer: 276439, endOdometer: 277012 },
  { date: '2026-08-14', startOdometer: 277012, endOdometer: 277514 },
  { date: '2026-08-15', startOdometer: 277514, endOdometer: 277514 },
  { date: '2026-08-16', startOdometer: 277514, endOdometer: 278167 },
  { date: '2026-08-17', startOdometer: 278167, endOdometer: 278604 },
  { date: '2026-08-18', startOdometer: 278604, endOdometer: 278966 },
  { date: '2026-08-19', startOdometer: 278966, endOdometer: 279348 },
  { date: '2026-08-20', startOdometer: 279348, endOdometer: 279874 },
  { date: '2026-08-21', startOdometer: 279874, endOdometer: 280283 },
  { date: '2026-08-22', startOdometer: 280283, endOdometer: 280283 },
];

export const NLL182_ODOMETER_DRIVER_NAME = 'Jevgenij Finevičius';

export function odometerDistanceKm(startOdometer: number, endOdometer: number): number {
  return Math.round((endOdometer - startOdometer) * 10) / 10;
}

export function vehicleDayAssignmentId(vehicleId: string, date: string): string {
  return `vehicle-day-${vehicleId}-${date}`;
}

export function parseVehicleDayAssignmentId(value: string): { vehicleId: string; date: string } | null {
  const match = /^vehicle-day-(.+)-(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!match) return null;
  return { vehicleId: match[1], date: match[2] };
}
