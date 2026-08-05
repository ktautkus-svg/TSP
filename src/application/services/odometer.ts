export type OdometerValidationResult =
  | { ok: true; distanceKm: number }
  | {
      ok: false;
      code: 'NOT_A_NUMBER' | 'NEGATIVE' | 'END_BEFORE_START' | 'IMPLAUSIBLE_DISTANCE';
      message: string;
    };

export function validateOdometer(
  start: number,
  end: number,
  maximumPlausibleRouteKm = 1_000,
): OdometerValidationResult {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, code: 'NOT_A_NUMBER', message: 'Įveskite skaitinius odometro rodmenis.' };
  }

  if (start < 0 || end < 0) {
    return { ok: false, code: 'NEGATIVE', message: 'Odometro rodmuo negali būti neigiamas.' };
  }

  if (end < start) {
    return {
      ok: false,
      code: 'END_BEFORE_START',
      message: 'Galutinis odometro rodmuo negali būti mažesnis už pradinį.',
    };
  }

  const distanceKm = end - start;
  if (distanceKm > maximumPlausibleRouteKm) {
    return {
      ok: false,
      code: 'IMPLAUSIBLE_DISTANCE',
      message: `Skirtumas (${distanceKm} km) atrodo neįprastai didelis. Patikrinkite rodmenis.`,
    };
  }

  return { ok: true, distanceKm };
}
