import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vfsPath = resolve(root, 'node_modules/expo-sqlite/web/wa-sqlite/AccessHandlePoolVFS.js');
const workerPath = resolve(root, 'node_modules/expo-sqlite/web/worker.ts');

const vfsMarker = 'firo-opfs-reopen';
const workerMarker = 'firo-opfs-worker-queue';

const vfsMethod = `
  // ${vfsMarker}: Safari closes SyncAccessHandle after backgrounding.
  async reopenClosedHandles() {
    if (this.#reopenPromise) return this.#reopenPromise;
    this.#reopenPromise = this.#reopenClosedHandlesImpl().finally(() => {
      this.#reopenPromise = null;
    });
    return this.#reopenPromise;
  }

  async #reopenClosedHandlesImpl() {
    if (!this.#directoryHandle) return;
    const entries = Array.from(this.#mapAccessHandleToName.entries());
    for (const [oldHandle, name] of entries) {
      if (!this.#accessHandleIsClosed(oldHandle)) continue;
      const fileHandle = await this.#directoryHandle.getFileHandle(name);
      const nextHandle = await fileHandle.createSyncAccessHandle();
      this.#mapAccessHandleToName.delete(oldHandle);
      this.#mapAccessHandleToName.set(nextHandle, name);
      for (const [path, handle] of this.#mapPathToAccessHandle) {
        if (handle === oldHandle) this.#mapPathToAccessHandle.set(path, nextHandle);
      }
      if (this.#availableAccessHandles.has(oldHandle)) {
        this.#availableAccessHandles.delete(oldHandle);
        this.#availableAccessHandles.add(nextHandle);
      }
      for (const file of this.#mapIdToFile.values()) {
        if (file.accessHandle === oldHandle) file.accessHandle = nextHandle;
      }
    }
  }

  #accessHandleIsClosed(accessHandle) {
    try {
      accessHandle.getSize();
      return false;
    } catch (error) {
      return error?.name === 'InvalidStateError' || /AccessHandle is closed/i.test(String(error?.message ?? error));
    }
  }
`;

const workerPrelude = `
// ${workerMarker}
function firoClosedAccessHandle(error) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  return name === 'InvalidStateError' || /AccessHandle is closed/i.test(message);
}
let firoWorkerQueue = Promise.resolve();
`;

function patchVfs() {
  const source = readFileSync(vfsPath, 'utf8');
  if (source.includes(vfsMarker)) return;
  if (!source.includes('#mapIdToFile = new Map();')) {
    throw new Error('expo-sqlite AccessHandlePoolVFS shape changed');
  }
  const withField = source.replace(
    '#mapIdToFile = new Map();',
    '#mapIdToFile = new Map();\n  #reopenPromise = null;',
  );
  const closeBrace = withField.lastIndexOf('}');
  writeFileSync(vfsPath, `${withField.slice(0, closeBrace)}${vfsMethod}\n${withField.slice(closeBrace)}`);
}

function patchWorker() {
  const source = readFileSync(workerPath, 'utf8');
  if (source.includes(workerMarker)) return;
  const start = source.indexOf('self.onmessage = async (event: MessageEvent<SQLiteWorkerMessage>) => {');
  const end = source.indexOf('async function handleMessageImpl');
  if (start < 0 || end < 0) throw new Error('expo-sqlite worker shape changed');
  const replacement = `${workerPrelude}
self.onmessage = (event: MessageEvent<SQLiteWorkerMessage>) => {
  const run = firoWorkerQueue.then(() => firoProcessWorkerMessage(event), () => firoProcessWorkerMessage(event));
  firoWorkerQueue = run.then(() => undefined, () => undefined);
};

async function firoProcessWorkerMessage(event: MessageEvent<SQLiteWorkerMessage>) {
  let result: ResultType | null = null;
  let error: Error | null = null;
  try {
    const message = event.data as MessageTypeMap[typeof event.data.type];
    try {
      result = await handleMessageImpl(message);
    } catch (first) {
      if (!firoClosedAccessHandle(first) || !_vfs || typeof _vfs.reopenClosedHandles !== 'function') throw first;
      await _vfs.reopenClosedHandles();
      result = await handleMessageImpl(message);
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  const syncTrait = event.data.isSync
    ? {
        lockBuffer: event.data.lockBuffer,
        resultBuffer: event.data.resultBuffer,
      }
    : undefined;
  sendWorkerResult({
    id: event.data.id,
    result,
    error,
    syncTrait,
  });
}

`;
  writeFileSync(workerPath, `${source.slice(0, start)}${replacement}${source.slice(end)}`);
}

patchVfs();
patchWorker();
console.log('patched expo-sqlite OPFS access-handle lifecycle');
