import type {
  MatrixRequest,
  TravelCostProvider,
  TravelMatrix,
} from '@/domain/routing/models';

export class FallbackTravelCostProvider implements TravelCostProvider {
  readonly name: string;

  constructor(private readonly providers: readonly TravelCostProvider[]) {
    if (providers.length === 0) {
      throw new Error('Reikalingas bent vienas kelionės duomenų šaltinis.');
    }
    this.name = providers.map(({ name }) => name).join(' → ');
  }

  async getMatrix(request: MatrixRequest): Promise<TravelMatrix> {
    const errors: string[] = [];
    for (const provider of this.providers) {
      try {
        const matrix = await provider.getMatrix(request);
        return {
          ...matrix,
          warnings:
            errors.length === 0
              ? matrix.warnings
              : [
                  ...matrix.warnings,
                  `Panaudotas atsarginis šaltinis, nes ankstesni šaltiniai nepasiekiami: ${errors.join('; ')}`,
                ],
        };
      } catch (error) {
        errors.push(
          `${provider.name}: ${
            error instanceof Error ? error.message : 'nežinoma klaida'
          }`,
        );
      }
    }
    throw new Error(
      `Nepasiekiamas nė vienas kelionės duomenų šaltinis. ${errors.join('; ')}`,
    );
  }
}

