import {
  BLOCK_LIMITS,
  composeBlockField,
  parseBlock,
  readBlockField,
  type OpResult,
  type RemoteEntry,
  type RemoteSnapshot,
  type SyncOp,
} from '../../core/sync';
import { SyncError, siteRequest } from './http';
import type { MemorySyncAdapter } from './types';

/**
 * Claude → Settings → Your Claude.
 *
 * That page has two parts:
 *  - "Instructions": one free-text field Claude keeps in mind in every chat.
 *    OmniMemory writes here, in a marked block after anything you wrote
 *    yourself (the same approach as ChatGPT's custom instructions).
 *  - "Memory": written by Claude from your chats and changed by asking
 *    Claude in words ("Tell Claude what to change"). There's no plain way to
 *    add or remove one entry, so OmniMemory only reads it: it's shown on the
 *    dashboard and anything new is offered on the Review page.
 *
 * Read:
 *   GET  /api/account_profile                          {conversation_preferences}
 *   GET  /api/organizations                            which account is active
 *   GET  /api/organizations/{org}/memory               {memory} AI-written summary
 *   POST /api/organizations/{org}/melange/list         memory files
 * Write:
 *   PUT  /api/account_profile {conversation_preferences}
 *        (PATCH if the site no longer accepts PUT)
 *
 * Checked against a real account on 2026-11-15: PUT is accepted, changes
 * only this field, and the text appears under Instructions. An empty string
 * clears the field; null is rejected (400), so null is never sent. A Claude
 * tab that was already open keeps showing the old text in its settings
 * until it's reloaded.
 */

export const CLAUDE_SUMMARY_GROUP = 'Memory summary (written by Claude)';
const FILES_GROUP = 'Memory files (written by Claude)';
const INSTRUCTIONS_GROUP = 'Instructions';
const FIELD_LIMIT = BLOCK_LIMITS.claude?.field ?? 32_000;

interface AccountProfile {
  conversation_preferences?: string | null;
}

let orgId: string | null = null;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await siteRequest(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (response.status === 401 || response.status === 403) {
    throw new SyncError('Sign in to Claude to sync your memories.');
  }
  if (!response.ok) {
    throw new SyncError(`Claude returned an error (${response.status}).`);
  }
  return (await response.json()) as T;
}

async function readField(): Promise<string> {
  const profile = await api<AccountProfile>('/api/account_profile');
  return typeof profile.conversation_preferences === 'string' ? profile.conversation_preferences : '';
}

async function writeField(value: string): Promise<void> {
  const body = JSON.stringify({ conversation_preferences: value });
  const put = await siteRequest('/api/account_profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (put.ok) return;
  if (put.status === 405 || put.status === 404) {
    await api('/api/account_profile', { method: 'PATCH', body });
    return;
  }
  throw new SyncError(
    put.status === 401 || put.status === 403
      ? 'Sign in to Claude to sync your memories.'
      : `Claude returned an error (${put.status}).`,
  );
}

/** The account the page is using (Claude remembers it in a cookie). */
async function activeOrg(): Promise<string | null> {
  if (orgId) return orgId;
  const cookie = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
  const remembered = cookie ? decodeURIComponent(cookie[1]) : null;
  const list = await api<unknown>('/api/organizations').catch(() => null);
  const ids = Array.isArray(list)
    ? list.flatMap((org) => {
        const uuid = (org as Record<string, unknown>)?.uuid;
        return typeof uuid === 'string' ? [uuid] : [];
      })
    : [];
  orgId = (remembered && ids.includes(remembered) ? remembered : ids[0]) ?? null;
  return orgId;
}

/**
 * Claude's memory summary is Markdown: short sections, each with a bold or
 * "#" heading and a paragraph or a few bullets. Each section becomes one
 * entry on the dashboard.
 */
export function splitClaudeMemory(markdown: string): { title: string; text: string }[] {
  const sections: { title: string; text: string }[] = [];
  let title = '';
  let body: string[] = [];
  const flush = () => {
    const text = body.join('\n').trim();
    if (text) sections.push({ title, text });
    body = [];
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^(?:#{1,6}\s+(.+?)\s*#*|\*\*(.+?)\*\*:?)$/);
    if (heading) {
      flush();
      title = (heading[1] ?? heading[2] ?? '').replace(/:$/, '').trim();
      continue;
    }
    body.push(line);
  }
  flush();
  return sections.slice(0, 50);
}

async function readSummary(org: string): Promise<RemoteEntry[]> {
  const data = await api<{ memory?: unknown }>(`/api/organizations/${org}/memory`);
  const memory = typeof data.memory === 'string' ? data.memory : '';
  return splitClaudeMemory(memory).map((section, index) => ({
    id: `summary-${index}`,
    group: CLAUDE_SUMMARY_GROUP,
    title: section.title || undefined,
    text: section.text.slice(0, 4000),
  }));
}

/** Memory files, when the list includes their text. Anything else is skipped. */
async function readFiles(org: string): Promise<RemoteEntry[]> {
  const data = await api<{ data?: unknown }>(`/api/organizations/${org}/melange/list`, {
    method: 'POST',
    body: '{}',
  });
  const files = Array.isArray(data.data) ? data.data : [];
  return files.slice(0, 100).flatMap((raw, index) => {
    const file = raw as Record<string, unknown>;
    const text = [file.content, file.text, file.body, file.summary].find((value) => typeof value === 'string') as
      | string
      | undefined;
    if (!text?.trim()) return [];
    const name = [file.title, file.name, file.path].find((value) => typeof value === 'string') as string | undefined;
    const id = typeof file.id === 'string' ? file.id : typeof file.uuid === 'string' ? file.uuid : String(index);
    return [
      {
        id: `file-${id}`.slice(0, 200),
        group: FILES_GROUP,
        title: name?.replace(/\.md$/i, '').split('/').pop(),
        text: text.trim().slice(0, 4000),
      },
    ];
  });
}

export const claudeSync: MemorySyncAdapter = {
  async read({ light }): Promise<RemoteSnapshot> {
    const { outside, managed, blockBudget, needsRewrite } = readBlockField(await readField(), 'claude');
    const readOnly: RemoteEntry[] = [];
    if (outside.trim()) {
      readOnly.push({
        id: 'instructions',
        group: INSTRUCTIONS_GROUP,
        title: 'Instructions for Claude',
        text: outside.trim().slice(0, 4000),
      });
    }
    const unchangedGroups: string[] = [];
    if (light) {
      unchangedGroups.push(CLAUDE_SUMMARY_GROUP, FILES_GROUP);
    } else {
      const org = await activeOrg().catch(() => null);
      if (org) {
        const [summary, files] = await Promise.all([
          readSummary(org).catch(() => null),
          readFiles(org).catch(() => null),
        ]);
        if (summary) readOnly.push(...summary);
        else unchangedGroups.push(CLAUDE_SUMMARY_GROUP);
        if (files) readOnly.push(...files);
        else unchangedGroups.push(FILES_GROUP);
      } else {
        unchangedGroups.push(CLAUDE_SUMMARY_GROUP, FILES_GROUP);
      }
    }
    return { managed, readOnly, blockBudget, needsRewrite, unchangedGroups };
  },

  async apply(op: SyncOp): Promise<OpResult> {
    if (op.op !== 'set-block') return { ok: false, error: 'Claude doesn’t support this change.' };
    try {
      // Re-read right before writing so nothing typed meanwhile is lost.
      const current = await readField();
      const { outside } = parseBlock(current);
      const lines = op.lines.map((line) => line.text);
      let next = composeBlockField(outside, lines);
      while (next.length > FIELD_LIMIT && lines.length > 0) {
        lines.pop();
        next = composeBlockField(outside, lines);
      }
      if (next !== current) await writeField(next);
      // Check it really landed.
      const saved = parseBlock(await readField()).lines;
      const landed = saved.length === lines.length && saved.every((line, index) => line === lines[index]);
      if (!landed) return { ok: false, error: 'Claude didn’t keep the change. Try again from the dashboard.' };
      if (lines.length < op.lines.length) {
        return { ok: false, error: 'Some memories didn’t fit in Claude’s instructions.' };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Claude refused this change.' };
    }
  },
};
