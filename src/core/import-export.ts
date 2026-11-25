import { findSimilar, similarity } from './duplicates';
import { describeSensitive, findSensitive } from './sensitive';
import {
  MAX_CONTENT_LENGTH,
  SITE_IDS,
  isCategory,
  isSource,
  type Memory,
  type MemoryDraft,
  type SitePermissions,
} from './types';

export const EXPORT_FORMAT = 'omnimemory';
export const EXPORT_VERSION = 1;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exported_at: string;
  /** "library" = everything not in the trash; "all" also includes the trash. */
  scope: 'library' | 'all';
  count: number;
  memories: Memory[];
}

export function buildExport(memories: Memory[], options: { includeTrash?: boolean } = {}): ExportFile {
  const included = options.includeTrash
    ? memories
    : memories.filter((memory) => memory.status !== 'deleted');
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    scope: options.includeTrash ? 'all' : 'library',
    count: included.length,
    memories: included,
  };
}

export function exportFileName(date = new Date()): string {
  return `omnimemory-export-${date.toISOString().slice(0, 10)}.json`;
}

// ── Import ───────────────────────────────────────────────────────────────

export type ImportIssue = 'ok' | 'duplicate' | 'conflict' | 'sensitive' | 'invalid';

export interface ImportCandidate {
  /** Stable key for UI lists (index in the parsed file). */
  key: number;
  draft: MemoryDraft;
  issue: ImportIssue;
  detail?: string;
  /** Whether the review screen pre-selects it. Only clean items are. */
  selected: boolean;
}

export interface ParsedImport {
  formatLabel: string;
  drafts: MemoryDraft[];
  /** Entries that could not be read at all. */
  skipped: number;
}

const CONTENT_KEYS = ['content', 'text', 'memory', 'value', 'fact', 'description'];

function readPermissions(value: unknown): Partial<SitePermissions> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Partial<SitePermissions> = {};
  for (const site of SITE_IDS) {
    const flag = (value as Record<string, unknown>)[site];
    if (typeof flag === 'boolean') out[site] = flag;
  }
  return out;
}

function draftFromUnknown(entry: unknown, keepSource: boolean): MemoryDraft | null {
  if (typeof entry === 'string') {
    const content = entry.trim();
    return content ? { content, source: 'import' } : null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const key = CONTENT_KEYS.find((k) => typeof record[k] === 'string' && (record[k] as string).trim());
  if (!key) return null;
  if (record.status === 'deleted') return null; // never resurrect trash from a file
  return {
    content: (record[key] as string).trim(),
    category: isCategory(record.category) ? record.category : undefined,
    tags: Array.isArray(record.tags) ? record.tags.filter((t): t is string => typeof t === 'string') : [],
    source: keepSource && isSource(record.source) ? record.source : 'import',
    enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
    permissions: readPermissions(record.permissions),
    aiAllowed: record.aiAllowed === false ? false : undefined,
  };
}

/** Strip list markers so pasted bullet lists import cleanly. */
function draftsFromPlainText(text: string): MemoryDraft[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim())
    .filter((line) => line.length > 0)
    .map((content) => ({ content, source: 'import' as const }));
}

/**
 * Read an import. Accepts an OmniMemory export, a JSON array of strings or
 * objects (most "export my memories" formats), or plain text, one per line.
 * Throws only when the input is empty.
 */
export function parseImport(text: string): ParsedImport {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The file is empty.');

  let json: unknown;
  let isJson = false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      json = JSON.parse(trimmed);
      isJson = true;
    } catch {
      throw new Error('This looks like JSON but could not be parsed. Check the file is complete.');
    }
  }

  if (!isJson) {
    const drafts = draftsFromPlainText(trimmed);
    return { formatLabel: 'Plain text, one memory per line', drafts, skipped: 0 };
  }

  const isOmni =
    !!json && typeof json === 'object' && (json as Record<string, unknown>).format === EXPORT_FORMAT;
  let entries: unknown[];
  if (Array.isArray(json)) entries = json;
  else {
    const record = json as Record<string, unknown>;
    const list = record.memories ?? record.items ?? record.data;
    if (!Array.isArray(list)) throw new Error('No list of memories was found in this file.');
    entries = list;
  }

  const drafts: MemoryDraft[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const draft = draftFromUnknown(entry, isOmni);
    if (draft) drafts.push(draft);
    else skipped += 1;
  }
  return { formatLabel: isOmni ? 'OmniMemory export' : 'JSON list', drafts, skipped };
}

/**
 * Compare parsed drafts with the existing library (and with each other) so the
 * user can review before anything is written. Importing never overwrites: an
 * accepted item always becomes a new memory.
 */
export function reviewImport(drafts: MemoryDraft[], existing: Memory[]): ImportCandidate[] {
  const accepted: string[] = [];
  return drafts.map((draft, key) => {
    const content = draft.content;
    const make = (issue: ImportIssue, detail?: string): ImportCandidate => ({
      key,
      draft,
      issue,
      detail,
      selected: issue === 'ok',
    });

    if (content.length > MAX_CONTENT_LENGTH) {
      return make('invalid', `Longer than ${MAX_CONTENT_LENGTH} characters`);
    }
    const sensitive = findSensitive(content);
    if (sensitive.length > 0) return make('sensitive', describeSensitive(sensitive));

    if (accepted.some((other) => similarity(other, content) >= 0.82)) {
      return make('duplicate', 'Repeated in this file');
    }
    accepted.push(content);

    const [match] = findSimilar(content, existing);
    if (match?.kind === 'duplicate') return make('duplicate', 'Already in your library');
    if (match?.kind === 'conflict') {
      return make('conflict', `${match.reason}: “${truncate(match.memory.content, 80)}”`);
    }
    return make('ok');
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
