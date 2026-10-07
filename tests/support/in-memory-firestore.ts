/**
 * Minimal in-memory stand-in for `@google-cloud/firestore`, used only by
 * runtime API tests via `vi.mock('@google-cloud/firestore', ...)`.
 * Every `new Firestore()` shares one process-wide data map so the auth store,
 * route-sync store and the test itself see the same documents. Nothing here
 * opens a network connection or reads credentials.
 */

type Data = Record<string, unknown>;

const DELETE_MARKER = Symbol('FieldValue.delete');
const SERVER_TIMESTAMP = Symbol('FieldValue.serverTimestamp');

const collections = new Map<string, Map<string, Data>>();

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function table(name: string): Map<string, Data> {
  let current = collections.get(name);
  if (!current) {
    current = new Map();
    collections.set(name, current);
  }
  return current;
}

function resolveSpecial(value: unknown): unknown {
  if (value === SERVER_TIMESTAMP) return new Date().toISOString();
  return value;
}

function applyPatch(target: Data, patch: Data): Data {
  const next = clone(target);
  for (const [path, raw] of Object.entries(patch)) {
    const parts = path.split('.');
    let cursor: Data = next;
    for (const part of parts.slice(0, -1)) {
      if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
      cursor = cursor[part] as Data;
    }
    const leaf = parts[parts.length - 1]!;
    if (raw === DELETE_MARKER) delete cursor[leaf];
    else cursor[leaf] = clone(resolveSpecial(raw));
  }
  return next;
}

function firestoreError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

class DocumentSnapshot {
  constructor(readonly ref: DocumentReference, private readonly value: Data | undefined) {}
  get id(): string { return this.ref.id; }
  get exists(): boolean { return this.value !== undefined; }
  data(): Data | undefined { return clone(this.value); }
  get(field: string): unknown { return this.value?.[field]; }
}

class QuerySnapshot {
  constructor(readonly docs: DocumentSnapshot[]) {}
  get empty(): boolean { return this.docs.length === 0; }
  get size(): number { return this.docs.length; }
  forEach(callback: (document: DocumentSnapshot) => void): void { this.docs.forEach(callback); }
}

class DocumentReference {
  constructor(readonly collectionName: string, readonly id: string) {}
  get path(): string { return `${this.collectionName}/${this.id}`; }
  async get(): Promise<DocumentSnapshot> { return this.snapshot(); }
  snapshot(): DocumentSnapshot { return new DocumentSnapshot(this, table(this.collectionName).get(this.id)); }
  async set(data: Data, options?: { merge?: boolean }): Promise<void> { this.setSync(data, options); }
  setSync(data: Data, options?: { merge?: boolean }): void {
    const current = table(this.collectionName).get(this.id);
    table(this.collectionName).set(this.id, options?.merge && current ? applyPatch(current, data) : applyPatch({}, data));
  }
  async create(data: Data): Promise<void> { this.createSync(data); }
  createSync(data: Data): void {
    if (table(this.collectionName).has(this.id)) throw firestoreError(6, `Document already exists: ${this.path}`);
    table(this.collectionName).set(this.id, applyPatch({}, data));
  }
  async update(data: Data): Promise<void> { this.updateSync(data); }
  updateSync(data: Data): void {
    const current = table(this.collectionName).get(this.id);
    if (!current) throw firestoreError(5, `No document to update: ${this.path}`);
    table(this.collectionName).set(this.id, applyPatch(current, data));
  }
  async delete(): Promise<void> { this.deleteSync(); }
  deleteSync(): void { table(this.collectionName).delete(this.id); }
}

type Filter = { field: string; op: string; value: unknown };

function readField(data: Data, field: string): unknown {
  return field.split('.').reduce<unknown>((value, part) => (value && typeof value === 'object' ? (value as Data)[part] : undefined), data);
}

function matches(data: Data, filter: Filter): boolean {
  const actual = readField(data, filter.field) as never;
  const expected = filter.value as never;
  switch (filter.op) {
    case '==': return actual === expected;
    case '!=': return actual !== expected;
    case '<': return actual < expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '>=': return actual >= expected;
    case 'in': return (filter.value as unknown[]).includes(actual);
    case 'array-contains': return Array.isArray(actual) && (actual as unknown[]).includes(expected);
    default: throw new Error(`In-memory Firestore: unsupported operator ${filter.op}`);
  }
}

class Query {
  constructor(
    readonly collectionName: string,
    protected readonly filters: Filter[] = [],
    protected readonly order: { field: string; direction: 'asc' | 'desc' }[] = [],
    protected readonly max: number | null = null,
  ) {}
  where(field: string, op: string, value: unknown): Query {
    return new Query(this.collectionName, [...this.filters, { field, op, value }], this.order, this.max);
  }
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): Query {
    return new Query(this.collectionName, this.filters, [...this.order, { field, direction }], this.max);
  }
  limit(count: number): Query {
    return new Query(this.collectionName, this.filters, this.order, count);
  }
  async get(): Promise<QuerySnapshot> { return this.snapshot(); }
  snapshot(): QuerySnapshot {
    let entries = [...table(this.collectionName).entries()].filter(([, data]) => this.filters.every((filter) => matches(data, filter)));
    for (const { field, direction } of [...this.order].reverse()) {
      entries = entries.sort(([, left], [, right]) => {
        const a = readField(left, field) as never;
        const b = readField(right, field) as never;
        const result = a < b ? -1 : a > b ? 1 : 0;
        return direction === 'desc' ? -result : result;
      });
    }
    if (this.max !== null) entries = entries.slice(0, this.max);
    return new QuerySnapshot(entries.map(([id, data]) => new DocumentSnapshot(new DocumentReference(this.collectionName, id), data)));
  }
}

class CollectionReference extends Query {
  constructor(collectionName: string) { super(collectionName); }
  get id(): string { return this.collectionName; }
  doc(id?: string): DocumentReference {
    return new DocumentReference(this.collectionName, id ?? `auto-${Math.random().toString(36).slice(2, 14)}`);
  }
  async add(data: Data): Promise<DocumentReference> {
    const reference = this.doc();
    reference.createSync(data);
    return reference;
  }
}

class WriteBatch {
  private readonly operations: (() => void)[] = [];
  set(reference: DocumentReference, data: Data, options?: { merge?: boolean }): this { this.operations.push(() => reference.setSync(data, options)); return this; }
  create(reference: DocumentReference, data: Data): this { this.operations.push(() => reference.createSync(data)); return this; }
  update(reference: DocumentReference, data: Data): this { this.operations.push(() => reference.updateSync(data)); return this; }
  delete(reference: DocumentReference): this { this.operations.push(() => reference.deleteSync()); return this; }
  async commit(): Promise<void> { for (const operation of this.operations) operation(); }
}

class Transaction extends WriteBatch {
  async get(target: DocumentReference | Query): Promise<DocumentSnapshot | QuerySnapshot> {
    return target instanceof DocumentReference ? target.snapshot() : target.snapshot();
  }
  async getAll(...references: DocumentReference[]): Promise<DocumentSnapshot[]> {
    return references.map((reference) => reference.snapshot());
  }
}

export class Firestore {
  collection(name: string): CollectionReference { return new CollectionReference(name); }
  doc(path: string): DocumentReference {
    const [collectionName, id] = path.split('/');
    return new DocumentReference(collectionName!, id!);
  }
  batch(): WriteBatch { return new WriteBatch(); }
  async runTransaction<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    const transaction = new Transaction();
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  }
  async getAll(...references: DocumentReference[]): Promise<DocumentSnapshot[]> {
    return references.map((reference) => reference.snapshot());
  }
}

export const FieldValue = {
  serverTimestamp: () => SERVER_TIMESTAMP,
  delete: () => DELETE_MARKER,
};

export class Timestamp {
  static now(): string { return new Date().toISOString(); }
}

/** Test helpers — not part of the Firestore API surface. */
export const inMemoryFirestore = {
  reset(): void { collections.clear(); },
  seed(collectionName: string, id: string, data: Data): void { table(collectionName).set(id, clone(data)); },
  read(collectionName: string, id: string): Data | undefined { return clone(table(collectionName).get(id)); },
  list(collectionName: string): Data[] { return [...table(collectionName).values()].map((value) => clone(value)); },
  ids(collectionName: string): string[] { return [...table(collectionName).keys()].sort(); },
};
