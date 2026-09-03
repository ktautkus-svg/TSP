import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { calculateTripFuelEnd } from '../../src/application/trip-sheet/fuel-balance';

const source = readFileSync(resolve(import.meta.dirname, '../../src/app/trip-sheet.tsx'), 'utf8');
const vehicleSource = readFileSync(resolve(import.meta.dirname, '../../src/app/vehicle.tsx'), 'utf8');

describe('trip sheet fuel workflow', () => {
  it('calculates the remaining fuel from start, real refills and normative consumption', () => {
    expect(calculateTripFuelEnd(90, 45, 68.7)).toBeCloseTo(66.3);
    expect(calculateTripFuelEnd(null, 45, 68.7)).toBeNull();
    expect(calculateTripFuelEnd(10, 0, 20)).toBe(0);
  });

  it('shows one visible accounting report with fuel and odometer totals', () => {
    for (const label of ['PASKUTINIS ODOMETRAS', 'KURO LIKUTIS PRADŽIOJE', 'ĮPILTA', 'SUNAUDOTA PAGAL NORMĄ', 'DABARTINIS LIKUTIS']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('trip-sheet-report-table');
    expect(source).toContain('trip-sheet-period-calendar');
    expect(source).toContain('VISO PASIRINKTU LAIKOTARPIU');
    expect(source).not.toContain('Generuoti kelionės lapą');
    expect(source).not.toContain('+ Įvesti kurą');
    expect(source).not.toContain('+ Kuro papildymas');
    expect(source).not.toContain('fuel-entry-form-');
    expect(source).not.toContain('/fuel-entries');
    // Odometer and fuel editing belongs beside the selected vehicle, while
    // this screen remains a read-only report for the dispatcher.
    expect(source).not.toContain('trip-sheet-odometer-entry');
    expect(source).not.toContain('/api/trip-sheets/day-readings');
    expect(source).not.toContain('ATLYGIS');
    expect(source).toContain('TRIP_SHEET_GRID_COLUMNS');
    expect(source).toContain('trip-sheet-column-legend');
    expect(source).toContain('buildTripSheetPrintDocument');
    expect(source).toContain('Eksportuoti Excel');
    expect(source).toContain('document.body.appendChild(link)');
    expect(source).toContain('new Blob([payload]');
    expect(source).not.toContain('payload.buffer');
    expect(source).toContain("typeof document === 'undefined'");
    expect(source).toContain('vehicleDayFuelDistanceKm');
    expect(source).not.toContain('Sustojimo trukmė');
    expect(source).not.toContain('Stovėjimo laikas');
    expect(source).not.toContain('Kaina už litrą');
    expect(source).not.toContain('Degalinė');
    expect(source).not.toContain('timeStyle:');
  });

  it('edits existing daily odometer rows and assigns their driver explicitly', () => {
    expect(vehicleSource).toContain('editingReadingStart');
    expect(vehicleSource).toContain('editingReadingEnd');
    expect(vehicleSource).toContain('editingReadingDriverId');
    expect(vehicleSource).toContain('saveReading(reading)');
    expect(vehicleSource).toContain('add-vehicle-odometer-day');
    expect(vehicleSource).toContain('new-vehicle-odometer-day');
    expect(vehicleSource).toContain('saveNewReading');
    expect(vehicleSource).toContain('a.date.localeCompare(b.date)');
    expect(vehicleSource).not.toContain('Kelių dienų korekcija');
    expect(vehicleSource).not.toContain('vehicle-odometer-bulk-editor');
  });

  it('lets a standalone day reading be moved to a different date, and never silently skips refreshing after a save', () => {
    // A wrongly-dated standalone reading previously had no way to be
    // corrected at all — the edit form had no date field. Editing one now
    // deletes the old vehicle+date key and re-creates it under the new date.
    expect(vehicleSource).toContain('editingReadingDate');
    expect(vehicleSource).toContain("accessibilityLabel={`Data ${reading.date}`}");
    expect(vehicleSource).toContain('unassigned-day');
    // applyVehicle used to skip the /api/trip-sheets refetch entirely
    // whenever the (periodically, not instantly, rechecked) online flag was
    // stale-false — even right after a save that had just proven the
    // network worked — leaving a just-written entry invisible until the
    // next unrelated refresh.
    expect(vehicleSource).not.toContain('if (online) {\n      const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>(\'/api/trip-sheets\').catch(() => ({ tripSheets: [] }));');
    expect(vehicleSource).toContain('const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>(\'/api/trip-sheets\');');
  });

  it('lets a day be entered as km driven instead of typing the absolute odometer, and shows the driven distance', () => {
    // Drivers only know "how far did I drive today", not the raw end
    // odometer — the km field now fills the end odometer automatically
    // from start + km, and the start field itself defaults to the last
    // known odometer so nothing has to be looked up by hand.
    expect(vehicleSource).toContain('const applyKmToEnd = (startText: string, kmText: string, setEnd: (value: string) => void)');
    expect(vehicleSource).toContain("if (next && !newReadingStart && latestOdometer != null) setNewReadingStart(String(latestOdometer))");
    expect(vehicleSource).toContain('testID="new-vehicle-odometer-km"');
    expect(vehicleSource).toContain('setNewReadingKm(text); applyKmToEnd(newReadingStart, text, setNewReadingEnd)');
    expect(vehicleSource).toContain('setEditingReadingKm(text); applyKmToEnd(editingReadingStart, text, setEditingReadingEnd)');
    // The list previously showed only the raw odometer range, never the
    // distance actually driven that day.
    expect(vehicleSource).toContain('km per dieną');
  });

  it('keeps one-driver report fuel continuity on the vehicle month instead of resetting to opening fuel', () => {
    expect(source).toContain('buildMonthlyGroups(visible, sheets)');
    expect(source).toContain('function buildDailyRows(sheets: DisplayTripSheet[], ledgerSheets: DisplayTripSheet[] = sheets)');
    expect(source).toContain('const ledgerRows = buildDailyRowsWithoutLedger(ledgerSheets)');
    expect(source).toContain('const ledgerByDate = new Map(applyFuelLedger(ledgerRows, ledgerSheets).map((row) => [row.date, row]))');
  });

  it('wires admin-only vehicle changes for completed trip sheets and driver changes for fuel', () => {
    expect(vehicleSource).toContain('editingReadingVehicleId');
    expect(vehicleSource).toContain("vehicleId: profile.role === 'admin' ? editingReadingVehicleId || selectedVehicleId : undefined");
    expect(vehicleSource).toContain("profile.role === 'admin' && !parseVehicleDayAssignmentId(reading.assignmentId)");
    expect(vehicleSource).toContain('fuelDriverId');
    expect(vehicleSource).toContain("driverId: profile.role === 'admin' && fuelDriverId ? fuelDriverId : undefined");
    expect(vehicleSource).toContain('entry.driverName');
  });
});
