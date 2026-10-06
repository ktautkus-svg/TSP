import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AccessHandleSession, isClosedAccessHandleError, userSafeStorageMessage, withStorageRetry } from '../../src/database/opfs-access-handle';

describe('OPFS access handle lifecycle', () => {
  it('reopens a closed handle and retries the statistics read once', async () => {
    let opened = 0;
    const session = new AccessHandleSession<{ id: string; closed: boolean; reads: number; getSize: () => number }>(async (id) => {
      opened += 1;
      return { id, closed: false, reads: 0, getSize: () => 1 };
    });
    const closed = {
      id: 'stats.db',
      closed: true,
      reads: 0,
      getSize: () => { throw Object.assign(new Error('AccessHandle is closed'), { name: 'InvalidStateError' }); },
    };
    session.bind(closed);

    const value = await session.withHandle('stats.db', (handle) => {
      if (handle.closed) throw Object.assign(new Error('AccessHandle is closed'), { name: 'InvalidStateError' });
      return 'rows';
    });

    expect(value).toBe('rows');
    expect(opened).toBe(1);
    expect(isClosedAccessHandleError(Object.assign(new Error('AccessHandle is closed'), { name: 'InvalidStateError' }))).toBe(true);
  });

  it('does not close a handle that another operation is still using', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const handle = { id: 'stats.db', closed: false, close: () => { handle.closed = true; } };
    const session = new AccessHandleSession(async () => handle);
    session.bind(handle);

    const read = session.withHandle('stats.db', async () => {
      await gate;
      return 'ok';
    });
    session.requestClose();
    expect(handle.closed).toBe(false);
    release();
    await read;
    expect(handle.closed).toBe(true);
  });

  it('retries a statistics read once and hides the raw browser error', async () => {
    let calls = 0;
    const rows = await withStorageRetry(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('InvalidStateError: AccessHandle is closed'), { name: 'InvalidStateError' });
      return [{ route: 'R1' }];
    });
    expect(rows).toEqual([{ route: 'R1' }]);
    expect(userSafeStorageMessage(new Error('InvalidStateError: AccessHandle is closed'))).toBe('Vietinė statistika laikinai nepasiekiama. Palaukite ir bandykite dar kartą.');
    expect(userSafeStorageMessage(new Error('InvalidStateError: AccessHandle is closed'))).not.toContain('AccessHandle');

    const statistics = readFileSync(resolve(import.meta.dirname, '../../src/app/statistics.tsx'), 'utf8');
    const worker = readFileSync(resolve(import.meta.dirname, '../../node_modules/expo-sqlite/web/worker.ts'), 'utf8');
    const vfs = readFileSync(resolve(import.meta.dirname, '../../node_modules/expo-sqlite/web/wa-sqlite/AccessHandlePoolVFS.js'), 'utf8');
    expect(statistics).toContain('withStorageRetry');
    expect(statistics).toContain('userSafeStorageMessage');
    expect(statistics).not.toContain('reason instanceof Error ? reason.message');
    expect(worker).toContain('firo-opfs-worker-queue');
    expect(worker).toContain('reopenClosedHandles');
    expect(vfs).toContain('firo-opfs-reopen');
  });
});
