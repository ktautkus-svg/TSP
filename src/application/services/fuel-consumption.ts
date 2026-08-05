export type FuelIntervalEntry = {
  id: string;
  odometer: number;
  liters: number;
  fullTank: boolean;
};

export type FullTankConsumptionResult =
  | {
      reliable: true;
      startEntryId: string;
      endEntryId: string;
      distanceKm: number;
      actualLiters: number;
      actualLPer100Km: number;
      normativeLiters: number;
      savingLiters: number;
      savingLPer100Km: number;
      savingPercent: number;
    }
  | {
      reliable: false;
      reason: 'NEED_TWO_FULL_TANKS' | 'INVALID_ODOMETER_SEQUENCE' | 'ZERO_DISTANCE';
      recordedLiters: number;
    };

/**
 * Įrašai turi apimti vieną pilno bako intervalą: pirmasis pilnas pylimas nustato
 * pradžią, visi vėlesni pylimai (įskaitant baigiamąjį pilną) sudaro sunaudotą kiekį.
 */
export function calculateFullTankConsumption(
  entries: FuelIntervalEntry[],
  baseNormLPer100Km: number,
): FullTankConsumptionResult {
  if (!Number.isFinite(baseNormLPer100Km) || baseNormLPer100Km <= 0) {
    throw new Error('Bazinė degalų norma turi būti didesnė už nulį.');
  }
  if (
    entries.some(
      (entry) =>
        !Number.isFinite(entry.odometer) ||
        !Number.isFinite(entry.liters) ||
        entry.odometer < 0 ||
        entry.liters <= 0,
    )
  ) {
    throw new Error('Degalų įrašo odometras ir litrai turi būti teigiami skaičiai.');
  }

  const firstFullIndex = entries.findIndex((entry) => entry.fullTank);
  const lastFullIndex = entries.findLastIndex((entry) => entry.fullTank);
  const recordedLiters = entries.reduce((sum, entry) => sum + entry.liters, 0);

  if (firstFullIndex < 0 || lastFullIndex <= firstFullIndex) {
    return { reliable: false, reason: 'NEED_TWO_FULL_TANKS', recordedLiters };
  }

  const interval = entries.slice(firstFullIndex, lastFullIndex + 1);
  if (interval.some((entry, index) => index > 0 && entry.odometer < interval[index - 1].odometer)) {
    return { reliable: false, reason: 'INVALID_ODOMETER_SEQUENCE', recordedLiters };
  }

  const distanceKm = interval.at(-1)!.odometer - interval[0].odometer;
  if (distanceKm === 0) {
    return { reliable: false, reason: 'ZERO_DISTANCE', recordedLiters };
  }

  const actualLiters = interval.slice(1).reduce((sum, entry) => sum + entry.liters, 0);
  const actualLPer100Km = (actualLiters / distanceKm) * 100;
  const normativeLiters = (distanceKm * baseNormLPer100Km) / 100;
  const savingLiters = normativeLiters - actualLiters;
  const savingLPer100Km = baseNormLPer100Km - actualLPer100Km;

  return {
    reliable: true,
    startEntryId: interval[0].id,
    endEntryId: interval.at(-1)!.id,
    distanceKm,
    actualLiters,
    actualLPer100Km,
    normativeLiters,
    savingLiters,
    savingLPer100Km,
    savingPercent: (savingLiters / normativeLiters) * 100,
  };
}
