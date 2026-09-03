/**
 * Manual fuel-fill list for a selected vehicle.
 *
 * Vehicle screens flatten fuel rows off trip-sheet day readings. The same
 * fill can appear on both an assignment sheet and a vehicle-day sheet, so
 * the list is de-duplicated by id and ordered oldest-first so a full month
 * (e.g. August) can be scanned in chronological order.
 */
export type ListedFuelEntry = {
  id: string;
  vehicleId: string;
  filledAt: string;
};

export function chronologicalVehicleFuelEntries<T extends ListedFuelEntry>(
  readings: readonly { fuelEntries?: readonly T[] | null }[],
  vehicleId: string,
): T[] {
  if (!vehicleId) return [];
  const seen = new Set<string>();
  const entries: T[] = [];
  for (const reading of readings) {
    for (const entry of reading.fuelEntries ?? []) {
      if (entry.vehicleId !== vehicleId) continue;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return entries.sort((left, right) => {
    const byTime = left.filledAt.localeCompare(right.filledAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
}
