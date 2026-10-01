type DatabaseListener = (databaseName: string) => void;

const listeners = new Set<DatabaseListener>();

export function subscribeActiveDatabase(listener: DatabaseListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishActiveDatabase(databaseName: string): void {
  for (const listener of listeners) listener(databaseName);
}
