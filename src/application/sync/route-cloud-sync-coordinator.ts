export type RouteCloudSyncStatus = 'synced' | 'syncing' | 'offline' | 'error' | 'attention';

/** Counts from a pass that finished, but left something unresolved. */
export type RouteCloudSyncAttention = {
  foreign: number;
  rejected: number;
  deferred: number;
  conflicts: number;
};

export type RouteCloudSyncState = {
  status: RouteCloudSyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
  attention: RouteCloudSyncAttention | null;
  revision: number;
};

export type RouteCloudSyncTrigger =
  | 'startup'
  | 'home-focus'
  | 'dispatcher-refresh'
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
  attention: null,
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

      this.publish({ status: 'syncing', error: null, attention: null });
      try {
        const outcome = await this.options.sync();
        if (this.stopped) return;
        if (!this.online) {
          this.publish({ status: 'offline', error: null });
          return;
        }
        // A pass can finish without failing and still leave work unresolved.
        // Reporting that as plain "Sinchronizuota" would tell the driver their
        // data is safely in the cloud when some of it deliberately is not.
        const attention = attentionFrom(outcome);
        this.publish({
          status: attention ? 'attention' : 'synced',
          lastSyncedAt: (this.options.now ?? (() => new Date().toISOString()))(),
          error: null,
          attention,
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

/**
 * Reads the unresolved counts out of a completed sync pass.
 *
 * `deleted` is deliberately not one of them: a tombstone that synchronised
 * successfully is finished work, not something the driver has to look at.
 */
export function attentionFrom(outcome: unknown): RouteCloudSyncAttention | null {
  if (!outcome || typeof outcome !== 'object') return null;
  const counts = outcome as Record<string, unknown>;
  const attention: RouteCloudSyncAttention = {
    foreign: positiveCount(counts.foreign),
    rejected: positiveCount(counts.rejected),
    deferred: positiveCount(counts.deferred),
    conflicts: positiveCount(counts.conflicts),
  };
  const total = attention.foreign + attention.rejected + attention.deferred + attention.conflicts;
  return total > 0 ? attention : null;
}

/**
 * Plain-language explanation of what is unresolved and what happens next.
 * Deliberately free of counts and internal vocabulary: the driver needs to know
 * whether their work is safe and whether they must act, not how sync is built.
 */
export function describeAttention(attention: RouteCloudSyncAttention): string {
  const reasons: string[] = [];
  if (attention.foreign > 0) {
    reasons.push('Įrenginyje yra maršrutų, sukurtų su kita paskyra. Jie lieka įrenginyje, bet į šios paskyros debesį nesiunčiami.');
  }
  if (attention.rejected > 0) {
    reasons.push('Dalies įrašų išsiųsti nepavyko. Jie lieka įrenginyje ir bus išsiųsti automatiškai per kitą sinchronizavimą.');
  }
  if (attention.deferred > 0) {
    reasons.push('Dalis gautų duomenų bus pritaikyta vėliau — dabar vykdomas kitas maršrutas.');
  }
  if (attention.conflicts > 0) {
    reasons.push('Kito įrenginio duomenys nesutampa su vykdomu maršrutu. Šis maršrutas paliktas įrenginyje ir nebuvo perrašytas.');
  }
  return reasons.join('\n\n');
}

function positiveCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

export function isNetworkFailure(reason: unknown): boolean {
  if (reason instanceof TypeError) return true;
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  return /network request failed|failed to fetch|networkerror|offline|internet/i.test(message);
}
