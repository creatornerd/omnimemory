import type { SiteSyncState } from './sync';
import type { Memory, Settings, SiteId } from './types';

/**
 * The only thing the rest of the app knows about persistence.
 *
 * The MVP ships one implementation (IndexedDB). A remote backend — for example
 * Supabase — can be added by implementing this same interface, or by wrapping
 * the local backend in a sync layer that replays writes. See docs/ARCHITECTURE.md.
 */
export interface StorageBackend {
  getAllMemories(): Promise<Memory[]>;
  getMemory(id: string): Promise<Memory | undefined>;
  putMemories(memories: Memory[]): Promise<void>;
  deleteMemories(ids: string[]): Promise<void>;
  getSettings(): Promise<Partial<Settings> | undefined>;
  putSettings(settings: Settings): Promise<void>;
  /** Bookkeeping for keeping a chatbot's own memory in step (core/sync.ts). */
  getSyncState(site: SiteId): Promise<SiteSyncState | undefined>;
  putSyncState(state: SiteSyncState): Promise<void>;
  /** Small secrets (the Gemini API key). Never exported, never sent to a page. */
  getSecret(name: string): Promise<string | undefined>;
  putSecret(name: string, value: string | null): Promise<void>;
}

/** Volatile backend used by tests and as a reference implementation. */
export class InMemoryBackend implements StorageBackend {
  private memories = new Map<string, Memory>();
  private settings: Settings | undefined;
  private sync = new Map<SiteId, SiteSyncState>();
  private secrets = new Map<string, string>();

  async getAllMemories(): Promise<Memory[]> {
    return [...this.memories.values()].map((m) => structuredClone(m));
  }

  async getMemory(id: string): Promise<Memory | undefined> {
    const found = this.memories.get(id);
    return found ? structuredClone(found) : undefined;
  }

  async putMemories(memories: Memory[]): Promise<void> {
    for (const memory of memories) this.memories.set(memory.id, structuredClone(memory));
  }

  async deleteMemories(ids: string[]): Promise<void> {
    for (const id of ids) this.memories.delete(id);
  }

  async getSettings(): Promise<Partial<Settings> | undefined> {
    return this.settings ? structuredClone(this.settings) : undefined;
  }

  async putSettings(settings: Settings): Promise<void> {
    this.settings = structuredClone(settings);
  }

  async getSyncState(site: SiteId): Promise<SiteSyncState | undefined> {
    const found = this.sync.get(site);
    return found ? structuredClone(found) : undefined;
  }

  async putSyncState(state: SiteSyncState): Promise<void> {
    this.sync.set(state.site, structuredClone(state));
  }

  async getSecret(name: string): Promise<string | undefined> {
    return this.secrets.get(name);
  }

  async putSecret(name: string, value: string | null): Promise<void> {
    if (value === null) this.secrets.delete(name);
    else this.secrets.set(name, value);
  }
}
