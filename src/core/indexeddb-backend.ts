import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StorageBackend } from './backend';
import type { SiteSyncState } from './sync';
import type { Memory, Settings, SiteId } from './types';

interface OmniSchema extends DBSchema {
  memories: {
    key: string;
    value: Memory;
    indexes: { status: string; updated_at: string };
  };
  settings: {
    key: string;
    value: Settings;
  };
  sync: {
    key: string;
    value: SiteSyncState;
  };
}

const DB_NAME = 'omnimemory';
const DB_VERSION = 2;
const SETTINGS_KEY = 'settings';

/**
 * Local-first persistence. The database lives in the extension's own origin,
 * so web pages (including the chatbot sites) can never read it directly —
 * content scripts have to ask the service worker.
 */
export class IndexedDbBackend implements StorageBackend {
  private dbPromise: Promise<IDBPDatabase<OmniSchema>> | undefined;

  constructor(private readonly name: string = DB_NAME) {}

  private db(): Promise<IDBPDatabase<OmniSchema>> {
    this.dbPromise ??= openDB<OmniSchema>(this.name, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('memories')) {
          const store = db.createObjectStore('memories', { keyPath: 'id' });
          store.createIndex('status', 'status');
          store.createIndex('updated_at', 'updated_at');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        // v2: chatbot memory sync bookkeeping, one record per site.
        if (!db.objectStoreNames.contains('sync')) {
          db.createObjectStore('sync', { keyPath: 'site' });
        }
      },
    });
    return this.dbPromise;
  }

  async getAllMemories(): Promise<Memory[]> {
    return (await this.db()).getAll('memories');
  }

  async getMemory(id: string): Promise<Memory | undefined> {
    return (await this.db()).get('memories', id);
  }

  async putMemories(memories: Memory[]): Promise<void> {
    if (memories.length === 0) return;
    const tx = (await this.db()).transaction('memories', 'readwrite');
    for (const memory of memories) void tx.store.put(memory);
    await tx.done;
  }

  async deleteMemories(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const tx = (await this.db()).transaction('memories', 'readwrite');
    for (const id of ids) void tx.store.delete(id);
    await tx.done;
  }

  async getSettings(): Promise<Partial<Settings> | undefined> {
    return (await this.db()).get('settings', SETTINGS_KEY);
  }

  async putSettings(settings: Settings): Promise<void> {
    await (await this.db()).put('settings', settings, SETTINGS_KEY);
  }

  async getSyncState(site: SiteId): Promise<SiteSyncState | undefined> {
    return (await this.db()).get('sync', site);
  }

  async putSyncState(state: SiteSyncState): Promise<void> {
    await (await this.db()).put('sync', state);
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    (await this.dbPromise).close();
    this.dbPromise = undefined;
  }
}
