import { Firestore } from '@google-cloud/firestore';

import type { EncryptedSecret } from './mail-token-crypto.js';

export type StoredMailConnection = {
  userId: string;
  provider: 'gmail';
  email: string;
  refreshToken: EncryptedSecret;
  accessToken: EncryptedSecret;
  accessTokenExpiresAt: string;
};

export interface MailConnectionRepository {
  saveState(state: string, userId: string, expiresAt: string): Promise<void>;
  consumeState(state: string): Promise<string | null>;
  saveConnection(connection: StoredMailConnection): Promise<void>;
  getConnection(userId: string): Promise<StoredMailConnection | null>;
  deleteConnection(userId: string): Promise<void>;
}

export class MemoryMailConnectionRepository implements MailConnectionRepository {
  private readonly states = new Map<string, { userId: string; expiresAt: string }>();
  private readonly connections = new Map<string, StoredMailConnection>();

  async saveState(state: string, userId: string, expiresAt: string): Promise<void> {
    this.states.set(state, { userId, expiresAt });
  }

  async consumeState(state: string): Promise<string | null> {
    const stored = this.states.get(state);
    this.states.delete(state);
    if (!stored || Date.parse(stored.expiresAt) <= Date.now()) return null;
    return stored.userId;
  }

  async saveConnection(connection: StoredMailConnection): Promise<void> {
    this.connections.set(connection.userId, connection);
  }

  async getConnection(userId: string): Promise<StoredMailConnection | null> {
    return this.connections.get(userId) ?? null;
  }

  async deleteConnection(userId: string): Promise<void> {
    this.connections.delete(userId);
  }
}

export class FirestoreMailConnectionRepository implements MailConnectionRepository {
  private readonly states = new Firestore().collection('tsp_mail_oauth_states');
  private readonly connections = new Firestore().collection('tsp_mail_connections');

  async saveState(state: string, userId: string, expiresAt: string): Promise<void> {
    await this.states.doc(state).set({ userId, expiresAt });
  }

  async consumeState(state: string): Promise<string | null> {
    const reference = this.states.doc(state);
    const document = await reference.get();
    const data = document.data() as { userId?: string; expiresAt?: string } | undefined;
    await reference.delete();
    if (!data || typeof data.userId !== 'string' || typeof data.expiresAt !== 'string') return null;
    if (Date.parse(data.expiresAt) <= Date.now()) return null;
    return data.userId;
  }

  async saveConnection(connection: StoredMailConnection): Promise<void> {
    await this.connections.doc(connection.userId).set(connection);
  }

  async getConnection(userId: string): Promise<StoredMailConnection | null> {
    const document = await this.connections.doc(userId).get();
    return document.exists ? document.data() as StoredMailConnection : null;
  }

  async deleteConnection(userId: string): Promise<void> {
    await this.connections.doc(userId).delete();
  }
}
