export type RouteCloudSyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export type RouteCloudSyncState = {
  status: RouteCloudSyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
  revision: number;
};

export type RouteCloudSyncTrigger =
  | 'startup'
  | 'home-focus'
  | 'foreground'
  | 'window-focus'
  | 'network-restored'
  | 'mutation'
  | 'manual-retry';

type CoordinatorOptions = {
  sync: () => Promise<unknown>;
  onStateChange?: (state: RouteCloudSyncState) => void;
  initialOnline?: boolean;
  now?: () => string;
};

const initialState: RouteCloudSyncState = {
  status: 'syncing',
  lastSyncedAt: null,
  error: null,
  revision: 0,
};

/**
 * Serializes event-driven sync requests. Bursts are coalesced into one pass;
 * a mutation arriving during an active pass schedules exactly one follow-up.
 * Errors are converted to UI state and never escape into the local workflow.
 */
export class RouteCloudSyncCoordinator {
  private state: RouteCloudSyncState;
  private online: boolean;
  private pending = false;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly options: CoordinatorOptions) {
    this.online = options.initialOnline ?? true;
    this.state = this.online ? initialState : { ...initialState, status: 'offline' };
  }

  getState(): RouteCloudSyncState {
    return this.state;
  }

  setOnline(online: boolean): void {
    this.online = online;
    if (!online) {
      this.pending = false;
      this.publish({ status: 'offline', error: null });
    }
  }

  trigger(_reason: RouteCloudSyncTrigger): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.pending = true;
    if (!this.running) {
      // Starting on the next microtask lets focus/foreground/online bursts
      // collapse into one request without adding a timer or polling loop.
      this.running = Promise.resolve()
        .then(() => this.drain())
        .finally(() => { this.running = null; });
    }
    return this.running;
  }

  stop(): void {
    this.stopped = true;
    this.pending = false;
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.stopped) {
      this.pending = false;
      if (!this.online) {
        this.publish({ status: 'offline', error: null });
        return;
      }

      this.publish({ status: 'syncing', error: null });
      try {
        await this.options.sync();
        if (this.stopped) return;
        if (!this.online) {
          this.publish({ status: 'offline', error: null });
          return;
        }
        this.publish({
          status: 'synced',
          lastSyncedAt: (this.options.now ?? (() => new Date().toISOString()))(),
          error: null,
          revision: this.state.revision + 1,
        });
      } catch (reason) {
        if (this.stopped) return;
        this.pending = false;
        const message = reason instanceof Error ? reason.message : 'Sinchronizuoti nepavyko.';
        this.publish({
          status: isNetworkFailure(reason) ? 'offline' : 'error',
          error: message,
        });
        return;
      }
    }
  }

  private publish(patch: Partial<RouteCloudSyncState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onStateChange?.(this.state);
  }
}

export function isNetworkFailure(reason: unknown): boolean {
  if (reason instanceof TypeError) return true;
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  return /network request failed|failed to fetch|networkerror|offline|internet/i.test(message);
}
