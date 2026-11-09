import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToRequests } from 'node:timers/promises';

import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError } from '@/shared/index.js';
import type { NormalizedMessage, SessionMessageSearchPage, SessionMessageWindow } from '@/shared/index.js';

type Snapshot = { token: string; key: string; created: number; touched: number; bytes: number;
  messages: NormalizedMessage[]; folded: string[]; queries: Map<string, number[]> };
const PAGE_SIZE = 40;
const RADIUS = 15;
const EXPIRES_MS = 10 * 60_000;

/** Session search routes reuse short-lived, owned transcript snapshots for bounded search pages and exact navigation. */
export function createSessionMessageSearchService(history = sessionsService.fetchHistory.bind(sessionsService), now = Date.now) {
  const snapshots = new Map<string, Snapshot>();
  const pending = new Map<string, Promise<Snapshot>>();
  function prune() {
    for (const [id, value] of snapshots) if (now() - value.touched > EXPIRES_MS) snapshots.delete(id);
    let bytes = [...snapshots.values()].reduce((sum, value) => sum + value.bytes, 0);
    for (const [id, value] of snapshots) {
      if (snapshots.size <= 1 || (snapshots.size <= 4 && bytes <= 64 * 1024 * 1024)) break;
      snapshots.delete(id);bytes -= value.bytes;
    }
  }
  function read(key: string, token: string) {
    prune();const value = snapshots.get(token);
    if (!value || value.key !== key) throw new AppError('搜索结果已过期，请重新搜索。', { code: 'SEARCH_EXPIRED', statusCode: 410 });
    value.touched = now();snapshots.delete(token);snapshots.set(token, value);return value;
  }
  async function snapshot(key: string, sessionId: string, token?: string) {
    if (token) return read(key, token);
    prune();
    const cached = [...snapshots.values()].reverse().find(value => value.key === key && now() - value.created < 3000);
    if (cached) return read(key, cached.token);
    if (pending.has(key)) return pending.get(key)!;
    const operation = (async () => {
      const full = await history(sessionId, { limit: null, offset: 0 });
      const messages: NormalizedMessage[] = [], folded: string[] = [];let bytes = 0;
      for (let i = 0; i < full.messages.length; i++) {
        const message = full.messages[i];
        if (message.kind === 'text' && (message.role === 'user' || message.role === 'assistant') && message.content?.trim()
          && !message.isCompactSummary && !message.isThinking) {
          messages.push(message);folded.push(message.content.toLowerCase());bytes += message.content.length * 4 + 256;
        }
        if (i % 250 === 249) await yieldToRequests();
      }
      const value: Snapshot = { token: randomUUID(), key, messages, folded, bytes, created: now(), touched: now(), queries: new Map() };
      snapshots.set(value.token, value);prune();return value;
    })();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  }
  return {
    async search(owner: number, sessionId: string, query: string, offset = 0, token?: string): Promise<SessionMessageSearchPage> {
      const value = await snapshot(JSON.stringify([owner, sessionId]), sessionId, token);
      const needle = query.trim().toLowerCase();
      let matches = value.queries.get(needle);
      if (!matches) {
        matches = [];
        for (let i = 0; i < value.folded.length; i++) {
          if (value.folded[i].includes(needle)) matches.push(i);
          if (i % 250 === 249) await yieldToRequests();
        }
        if (value.queries.size >= 4) value.queries.delete(value.queries.keys().next().value!);
        value.queries.set(needle, matches);
      }
      return { snapshot: value.token, total: matches.length, offset, hasMore: offset + PAGE_SIZE < matches.length,
        hits: matches.slice(offset, offset + PAGE_SIZE).map(index => {
          const message = value.messages[index], text = message.content!;
          const at = value.folded[index].indexOf(needle), start = Math.max(0, at - 65), end = Math.min(text.length, at + needle.length + 115);
          return { index, messageId: message.id, role: message.role!, timestamp: message.timestamp,
            snippet: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}` };
        }) };
    },
    window(owner: number, sessionId: string, token: string, index: number): SessionMessageWindow {
      const value = read(JSON.stringify([owner, sessionId]), token);
      if (index < 0 || index >= value.messages.length) throw new AppError('搜索定位超出会话范围。', { code: 'INVALID_SEARCH_INDEX', statusCode: 400 });
      const start = Math.max(0, index - RADIUS), end = Math.min(value.messages.length, index + RADIUS + 1);
      return { snapshot: token, index, start, end, total: value.messages.length, messages: value.messages.slice(start, end) };
    },
  };
}

/** Shared by the authenticated provider routes; windows use the same snapshot as their search hits. */
export const sessionMessageSearchService = createSessionMessageSearchService();
