export type CargoLayoutRequest = {
  vehicle: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    hasRearDoors: boolean;
    hasSideDoors: boolean;
  };
  items: {
    id: string;
    stopId: string;
    deliveryOrder: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    weightKg: number;
  }[];
};

export type CargoPlacement = {
  itemId: string;
  xCm: number;
  yCm: number;
  zCm: number;
  rotation: 0 | 90 | 180 | 270;
};

/**
 * Ateities modulio kontraktas. Jis tyčia neturi priklausomybių nuo Route saugyklos
 * ar pristatymo būsenų mašinos.
 */
export interface CargoLayoutOptimizer {
  createPlan(request: CargoLayoutRequest): Promise<CargoPlacement[]>;
}
