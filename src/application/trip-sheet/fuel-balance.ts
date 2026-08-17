export function calculateTripFuelEnd(startLiters: number | null, addedLiters: number, consumedLiters: number | null): number | null {
  return startLiters === null || consumedLiters === null ? null : Math.max(0, startLiters + addedLiters - consumedLiters);
}
