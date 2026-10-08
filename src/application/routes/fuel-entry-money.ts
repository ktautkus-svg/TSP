/**
 * Monetary value of a fuel fill. Litres are never treated as euros.
 * A missing price stays unknown instead of falling back to a tariff guess.
 */
export type FuelMoneyEntry = {
  id: string;
  liters: number;
  pricePerLiter?: number | null;
  totalCost?: number | null;
  vehicleId?: string | null;
  registrationNumber?: string | null;
  tripSheetId?: string | null;
  status?: string | null;
  deleted?: boolean | null;
  deletedAt?: string | null;
};

export type FuelMoneyAllocation = {
  moneyEur: number | null;
  unpricedCount: number;
  countedIds: string[];
};

const EXCLUDED_STATUSES = new Set(['rejected', 'deleted', 'cancelled']);

export function roundFuelMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isExcludedFuelEntry(entry: FuelMoneyEntry, vehicleId?: string | null): boolean {
  if (entry.deleted || entry.deletedAt) return true;
  const status = entry.status?.trim().toLowerCase();
  if (status && EXCLUDED_STATUSES.has(status)) return true;
  if (vehicleId && entry.vehicleId && entry.vehicleId !== vehicleId) return true;
  return false;
}

/** Receipt total wins. Otherwise litres × price. Never the litre count itself. */
export function fuelEntryMoneyEur(entry: FuelMoneyEntry): number | null {
  if (isExcludedFuelEntry(entry)) return null;
  if (typeof entry.totalCost === 'number' && Number.isFinite(entry.totalCost) && entry.totalCost >= 0) {
    return roundFuelMoney(entry.totalCost);
  }
  if (
    typeof entry.pricePerLiter === 'number'
    && Number.isFinite(entry.pricePerLiter)
    && entry.pricePerLiter >= 0
    && Number.isFinite(entry.liters)
    && entry.liters >= 0
  ) {
    return roundFuelMoney(entry.liters * entry.pricePerLiter);
  }
  return null;
}

export function sumFuelMoney(entries: readonly FuelMoneyEntry[], vehicleId?: string | null): FuelMoneyAllocation {
  const seen = new Set<string>();
  let money = 0;
  let known = 0;
  let unpriced = 0;
  const countedIds: string[] = [];
  for (const entry of entries) {
    if (!entry.id || seen.has(entry.id) || isExcludedFuelEntry(entry, vehicleId)) continue;
    seen.add(entry.id);
    countedIds.push(entry.id);
    const amount = fuelEntryMoneyEur(entry);
    if (amount === null) unpriced += 1;
    else {
      known += 1;
      money += amount;
    }
  }
  return {
    moneyEur: known === 0 ? null : roundFuelMoney(money),
    unpricedCount: unpriced,
    countedIds,
  };
}

export type FuelSheetRef = {
  id: string;
  date: string;
  vehicleId: string | null;
  fuelEntries: readonly FuelMoneyEntry[];
};

/**
 * Each fill is counted once. It stays on the sheet that owns `tripSheetId`
 * when that sheet is in the period, otherwise on the first same-vehicle sheet.
 */
export function allocateFuelMoney(sheets: readonly FuelSheetRef[]): {
  bySheetId: Map<string, FuelMoneyAllocation>;
  total: FuelMoneyAllocation;
} {
  const bySheetId = new Map<string, FuelMoneyEntry[]>();
  for (const sheet of sheets) bySheetId.set(sheet.id, []);
  const claimed = new Set<string>();
  const sheetById = new Map(sheets.map((sheet) => [sheet.id, sheet]));

  const pool: { entry: FuelMoneyEntry; sheetId: string }[] = [];
  for (const sheet of sheets) {
    for (const entry of sheet.fuelEntries) pool.push({ entry, sheetId: sheet.id });
  }
  pool.sort((left, right) => left.entry.id.localeCompare(right.entry.id));

  for (const item of pool) {
    if (!item.entry.id || claimed.has(item.entry.id)) continue;
    if (isExcludedFuelEntry(item.entry, sheetById.get(item.sheetId)?.vehicleId)) continue;
    const ownerId = item.entry.tripSheetId && sheetById.has(item.entry.tripSheetId)
      ? item.entry.tripSheetId
      : item.sheetId;
    const owner = sheetById.get(ownerId);
    if (!owner || isExcludedFuelEntry(item.entry, owner.vehicleId)) continue;
    claimed.add(item.entry.id);
    bySheetId.get(ownerId)?.push(item.entry);
  }

  const allocations = new Map<string, FuelMoneyAllocation>();
  const all: FuelMoneyEntry[] = [];
  for (const [sheetId, entries] of bySheetId) {
    const allocation = sumFuelMoney(entries);
    allocations.set(sheetId, allocation);
    all.push(...entries);
  }
  return { bySheetId: allocations, total: sumFuelMoney(all) };
}
