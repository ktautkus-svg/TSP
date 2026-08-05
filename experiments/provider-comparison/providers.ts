import {
  GoogleTravelCostProvider as GoogleGatewayProvider,
  HereTravelCostProvider as HereGatewayProvider,
} from '../../src/infrastructure/routing/providers/gateway-travel-cost-provider';
import {
  SyntheticTravelCostProvider,
  type SyntheticMatrixMode,
} from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';
import type {
  MatrixRequest,
  TravelCostProvider,
  TravelMatrix,
} from '../../src/domain/routing/models';

type ProviderOptions = {
  useRealApi?: boolean;
  endpoint?: string;
};

class LabeledSyntheticProvider implements TravelCostProvider {
  constructor(
    readonly name: string,
    private readonly delegate: SyntheticTravelCostProvider,
  ) {}

  async getMatrix(request: MatrixRequest): Promise<TravelMatrix> {
    const matrix = await this.delegate.getMatrix(request);
    return {
      ...matrix,
      provider: this.name,
      executionMode: 'stub',
      warnings: [
        ...matrix.warnings,
        `${this.name} veikia stub režimu; tai nėra realūs tiekėjo duomenys.`,
      ],
    };
  }
}

export class MockTravelCostProvider extends LabeledSyntheticProvider {
  constructor() {
    super('Mock', new SyntheticTravelCostProvider('linear'));
  }
}

export class HereTravelCostProvider implements TravelCostProvider {
  readonly name = 'HERE';
  private readonly delegate: TravelCostProvider;

  constructor(options: ProviderOptions = {}) {
    this.delegate =
      options.useRealApi && options.endpoint
        ? new HereGatewayProvider(options.endpoint)
        : new LabeledSyntheticProvider('HERE', new SyntheticTravelCostProvider('city_traffic'));
  }

  getMatrix(request: MatrixRequest): Promise<TravelMatrix> {
    return this.delegate.getMatrix(request);
  }
}

export class GoogleTravelCostProvider implements TravelCostProvider {
  readonly name = 'Google Routes';
  private readonly delegate: TravelCostProvider;

  constructor(options: ProviderOptions = {}) {
    this.delegate =
      options.useRealApi && options.endpoint
        ? new GoogleGatewayProvider(options.endpoint)
        : new LabeledSyntheticProvider('Google Routes', new SyntheticTravelCostProvider('asymmetric'));
  }

  getMatrix(request: MatrixRequest): Promise<TravelMatrix> {
    return this.delegate.getMatrix(request);
  }
}

export function syntheticProvider(mode: SyntheticMatrixMode): TravelCostProvider {
  return new SyntheticTravelCostProvider(mode);
}
