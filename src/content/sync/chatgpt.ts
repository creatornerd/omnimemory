import {
  BLOCK_FIELD_LIMIT,
  blockLanded,
  safeBlockField,
  parseBlock,
  readBlockField,
  type OpResult,
  type RemoteEntry,
  type RemoteSnapshot,
  type SyncOp,
} from '../../core/sync';
import { send } from '../bridge';
import { SyncError, siteRequest, wait } from './http';
import type { MemorySyncAdapter } from './types';

/**
 * ChatGPT → Settings → Personalization.
 *
 * ChatGPT's "Memory summary" is written by AI from your chats and rewritten
 * every time it is opened, so anything added to it doesn't reliably stay.
 * ChatGPT itself says to use custom instructions for things it should always
 * keep in mind, so that is where OmniMemory writes: a marked block inside the
 * "More about you" field. The rest of that field, and every other custom
 * instruction, is left exactly as you wrote it.
 *
 * Read (shown in the dashboard):
 *   GET  /backend-api/user_system_messages            custom instructions
 *   GET  /backend-api/memories                        older "saved memories"
 *   GET  /backend-api/memories/about_you/summary/checksum
 *   POST /backend-api/memories/about_you/summary/stream   AI summary, only
 *        when the checksum says it changed (or on Refresh)
 * Write:
 *   PATCH /backend-api/user_system_messages {other_user_message}
 */

export const SUMMARY_GROUP = 'Memory summary (written by ChatGPT)';
const SAVED_GROUP = 'Saved memories';
const CUSTOM_GROUP = 'Custom instructions';
const SUMMARY_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface SystemMessages {
  about_model_message?: string;
  about_user_message?: string;
  name_user_message?: string;
  role_user_message?: string;
  other_user_message?: string;
  enabled?: boolean;
}

let session: { token: string; at: number } | null = null;

async function authHeaders(): Promise<Record<string, string>> {
  if (!session || Date.now() - session.at > 5 * 60 * 1000) {
    const response = await siteRequest('/api/auth/session');
    const data = response.ok ? ((await response.json()) as { accessToken?: unknown }) : {};
    if (typeof data.accessToken !== 'string') {
      session = null;
      throw new SyncError('Sign in to ChatGPT to sync your memories.');
    }
    session = { token: data.accessToken, at: Date.now() };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  };
  const device = document.cookie.match(/(?:^|;\s*)oai-did=([^;]+)/);
  if (device) headers['OAI-Device-Id'] = decodeURIComponent(device[1]);
  return headers;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await siteRequest(path, { ...init, headers: { ...(await authHeaders()), ...init.headers } });
  if (response.status === 401) {
    session = null;
    throw new SyncError('Sign in to ChatGPT to sync your memories.');
  }
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = `: ${body.detail}`;
    } catch {
      // not JSON
    }
    throw new SyncError(`ChatGPT returned an error (${response.status})${detail}`.slice(0, 280));
  }
  return (await response.json()) as T;
}

function readFields(): Promise<SystemMessages> {
  return api<SystemMessages>('/backend-api/user_system_messages');
}

/** Pull the final sections out of the summary's event stream. */
export function parseSummaryStream(body: string): { id: string; title: string; description: string }[] {
  let sections: { id: string; title: string; description: string }[] = [];
  for (const event of body.split(/\n\n+/)) {
    if (!/^event: done$/m.test(event)) continue;
    const data = event.match(/^data: (.*)$/m);
    if (!data) continue;
    try {
      const parsed = JSON.parse(data[1]) as { sections?: unknown };
      if (Array.isArray(parsed.sections)) {
        sections = parsed.sections.flatMap((section) => {
          const s = section as Record<string, unknown>;
          return typeof s.id === 'string' && typeof s.description === 'string'
            ? [{ id: s.id, title: typeof s.title === 'string' ? s.title : '', description: s.description }]
            : [];
        });
      }
    } catch {
      // ignore a malformed event
    }
  }
  return sections;
}

async function readSummary(refresh: boolean, cache: Record<string, string>): Promise<RemoteEntry[] | null> {
  const checksum = await api<{ sourceChecksum?: string }>(
    '/backend-api/memories/about_you/summary/checksum?source=personalization-setting',
  ).catch(() => null);
  const current = checksum?.sourceChecksum ?? '';
  const age = Date.now() - Number(cache.summaryAt ?? 0);
  if (!refresh && current && current === cache.summaryChecksum && age < SUMMARY_MAX_AGE_MS) return null;

  const response = await siteRequest('/backend-api/memories/about_you/summary/stream?source=personalization-setting', {
    method: 'POST',
    headers: await authHeaders(),
    body: '{}',
  });
  if (!response.ok) return null;
  const sections = parseSummaryStream(await response.text());
  await send({ type: 'sync/cache', key: 'summaryChecksum', value: current }).catch(() => {});
  await send({ type: 'sync/cache', key: 'summaryAt', value: String(Date.now()) }).catch(() => {});
  return sections.filter((section) => section.description.trim()).map((section) => ({
    id: `summary-${section.id}`.slice(0, 200),
    group: SUMMARY_GROUP,
    title: section.title,
    text: section.description,
  }));
}

async function readSaved(): Promise<RemoteEntry[]> {
  const data = await api<{ memories?: unknown }>('/backend-api/memories?include_memory_entries=false').catch(() => null);
  const list = Array.isArray(data?.memories) ? data.memories : [];
  return list.flatMap((item) => {
    const memory = item as Record<string, unknown>;
    const text = typeof memory.content === 'string' ? memory.content : '';
    const id = typeof memory.id === 'string' ? memory.id : '';
    return text && id ? [{ id: `saved-${id}`.slice(0, 200), group: SAVED_GROUP, text }] : [];
  });
}

function customEntries(fields: SystemMessages, outside: string): RemoteEntry[] {
  const entries: [string, string, string | undefined][] = [
    ['custom-nickname', 'Nickname', fields.name_user_message],
    ['custom-occupation', 'Occupation', fields.role_user_message],
    ['custom-about', 'More about you', outside],
    ['custom-about-legacy', 'About you', fields.about_user_message],
    ['custom-instructions', 'How ChatGPT should respond', fields.about_model_message],
  ];
  return entries.flatMap(([id, title, text]) =>
    text && text.trim() ? [{ id, group: CUSTOM_GROUP, title, text: text.trim().slice(0, 4000) }] : [],
  );
}

export const chatgptSync: MemorySyncAdapter = {
  async read({ refresh, light, cache }): Promise<RemoteSnapshot> {
    const fields = await readFields();
    const { outside, managed, blockBudget, needsRewrite } = readBlockField(fields.other_user_message ?? '');
    const readOnly = customEntries(fields, outside);
    const unchangedGroups: string[] = [];

    if (light) {
      unchangedGroups.push(SUMMARY_GROUP, SAVED_GROUP);
    } else {
      readOnly.push(...(await readSaved()));
      const summary = await readSummary(refresh, cache).catch(() => null);
      if (summary) readOnly.push(...summary);
      else unchangedGroups.push(SUMMARY_GROUP);
    }
    return { managed, readOnly, blockBudget, needsRewrite, unchangedGroups };
  },

  async apply(op: SyncOp): Promise<OpResult> {
    if (op.op !== 'set-block') return { ok: false, error: 'ChatGPT doesn’t support this change.' };
    try {
      // Re-read right before writing so nothing typed meanwhile is lost.
      const fields = await readFields();
      const current = fields.other_user_message ?? '';
      const { outside } = parseBlock(current);
      const lines = op.lines.map((line) => line.text);
      let next = safeBlockField(current, lines);
      while (next !== null && next.length > BLOCK_FIELD_LIMIT && lines.length > 0) {
        lines.pop();
        next = safeBlockField(current, lines);
      }
      if (next === null) return { ok: false, error: 'Stopped: writing would have changed your own text in ChatGPT’s custom instructions.' };
      if (next !== (fields.other_user_message ?? '')) {
        await api('/backend-api/user_system_messages', {
          method: 'PATCH',
          body: JSON.stringify({ other_user_message: next }),
        });
      }
      // Check it really landed. The site can take a moment to show a
      // change it accepted, so look a few times before calling it a failure
      // (that used to make a sync need a second try).
      let landed = false;
      for (let look = 0; look < 4 && !landed; look += 1) {
        if (look > 0) await wait(700);
        landed = blockLanded((await readFields()).other_user_message ?? '', outside, lines);
      }
      if (!landed) return { ok: false, error: 'ChatGPT didn’t keep the change. Try again from the dashboard.' };
      if (lines.length < op.lines.length) {
        return { ok: false, error: 'Some memories didn’t fit in ChatGPT’s custom instructions.' };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'ChatGPT refused this change.' };
    }
  },
};
