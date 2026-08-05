export type LoadDistanceInputLeg = {
  fromId: string;
  toId: string;
  distanceKm: number;
  carriedLoadKg: number;
};

export type LoadDistanceDetail = LoadDistanceInputLeg & {
  carriedLoadTonnes: number;
  tonneKilometers: number;
};

export function calculateLoadDistance(legs: LoadDistanceInputLeg[]): {
  legs: LoadDistanceDetail[];
  totalTonneKilometers: number;
} {
  const details = legs.map((leg) => {
    if (
      !Number.isFinite(leg.distanceKm) ||
      !Number.isFinite(leg.carriedLoadKg) ||
      leg.distanceKm < 0 ||
      leg.carriedLoadKg < 0
    ) {
      throw new Error('Atstumas ir vežamas svoris turi būti neneigiami skaičiai.');
    }
    const carriedLoadTonnes = leg.carriedLoadKg / 1_000;
    return {
      ...leg,
      carriedLoadTonnes,
      tonneKilometers: carriedLoadTonnes * leg.distanceKm,
    };
  });
  return {
    legs: details,
    totalTonneKilometers: details.reduce((sum, leg) => sum + leg.tonneKilometers, 0),
  };
}
