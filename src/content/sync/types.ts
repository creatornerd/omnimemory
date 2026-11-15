import type { OpResult, RemoteSnapshot, SyncOp } from '../../core/sync';

/** Reads and writes one chatbot's own memory, from inside its own site. */
export interface MemorySyncAdapter {
  /**
   * What the chatbot remembers now. `refresh` asks for anything expensive
   * (like ChatGPT's AI-written summary) to be fetched again; `light` skips
   * it entirely (used right after writing).
   */
  read(options: { refresh: boolean; light: boolean; cache: Record<string, string> }): Promise<RemoteSnapshot>;
  apply(op: SyncOp): Promise<OpResult>;
}
