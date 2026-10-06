export type AccessHandleLike = {
  id: string;
  closed?: boolean;
  getSize?: () => number;
  close?: () => void;
};

const USER_SAFE_STORAGE_MESSAGE = 'Vietinė statistika laikinai nepasiekiama. Palaukite ir bandykite dar kartą.';

export function isClosedAccessHandleError(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  return name === 'InvalidStateError' || /AccessHandle is closed/i.test(message);
}

export function userSafeStorageMessage(error: unknown): string {
  if (isClosedAccessHandleError(error)) return USER_SAFE_STORAGE_MESSAGE;
  return 'Statistikos atkurti nepavyko.';
}

/**
 * One in-flight operation owns the handle. A background close is deferred until
 * that operation finishes, and a closed handle is reopened once before retry.
 */
export class AccessHandleSession<T extends AccessHandleLike> {
  private readonly handles = new Map<string, T>();
  private inFlight = 0;
  private pendingClose = false;
  private reopen: Promise<void> | null = null;

  constructor(private readonly openHandle: (id: string) => Promise<T>) {}

  bind(handle: T): void {
    this.handles.set(handle.id, handle);
  }

  async withHandle<R>(id: string, operation: (handle: T) => R | Promise<R>): Promise<R> {
    this.inFlight += 1;
    try {
      const current = await this.currentHandle(id);
      try {
        return await operation(current);
      } catch (error) {
        if (!isClosedAccessHandleError(error) && !this.isClosed(current)) throw error;
        const reopened = await this.reopenOne(id);
        return await operation(reopened);
      }
    } finally {
      this.inFlight -= 1;
      if (this.inFlight === 0 && this.pendingClose) {
        this.pendingClose = false;
        this.releaseIdle();
      }
    }
  }

  requestClose(): void {
    if (this.inFlight > 0) {
      this.pendingClose = true;
      return;
    }
    this.releaseIdle();
  }

  private async currentHandle(id: string): Promise<T> {
    const existing = this.handles.get(id);
    if (existing && !this.isClosed(existing)) return existing;
    return this.reopenOne(id);
  }

  private isClosed(handle: T): boolean {
    if (handle.closed) return true;
    try {
      handle.getSize?.();
      return false;
    } catch (error) {
      return isClosedAccessHandleError(error);
    }
  }

  private async reopenOne(id: string): Promise<T> {
    if (!this.reopen) {
      this.reopen = (async () => {
        const previous = this.handles.get(id);
        const next = await this.openHandle(id);
        this.handles.set(id, next);
        if (previous && previous !== next) {
          try { previous.close?.(); } catch { /* Safari already closed it. */ }
        }
      })().finally(() => {
        this.reopen = null;
      });
    }
    await this.reopen;
    const handle = this.handles.get(id);
    if (!handle) throw new Error('OPFS handle missing after reopen');
    return handle;
  }

  private releaseIdle(): void {
    for (const handle of this.handles.values()) {
      try { handle.close?.(); } catch { /* already closed */ }
      handle.closed = true;
    }
  }
}

export async function withStorageRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isClosedAccessHandleError(error)) throw error;
    return operation();
  }
}
