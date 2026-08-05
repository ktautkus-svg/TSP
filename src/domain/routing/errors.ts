export class RoutingEngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RoutingEngineError';
  }
}

export class ProviderRequestError extends RoutingEngineError {
  constructor(
    message: string,
    readonly provider: string,
    readonly statusCode?: number,
    details?: Record<string, unknown>,
  ) {
    super(message, 'PROVIDER_REQUEST_FAILED', details);
    this.name = 'ProviderRequestError';
  }
}

export class InvalidMatrixError extends RoutingEngineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'INVALID_TRAVEL_MATRIX', details);
    this.name = 'InvalidMatrixError';
  }
}
