import { useCallback, useEffect, useRef, useState } from 'react';

import { sessionHistorySearchApi } from '@/shared/api';
import type { SessionMessageSearchPage, SessionHistoryLocation } from '@/shared/types';

/** ChatInterface owns this cancellable, debounced search independently of live transcript updates. */
export function useSessionHistorySearch(sessionId: string | null) {
  // Search controls stay local to the selected session.
  const [open, setOpen] = useState(false);
  // The input is immediate; only its debounced value issues a request.
  const [query, setQuery] = useState('');
  // At most one small result page is retained in the browser.
  const [page, setPage] = useState<SessionMessageSearchPage | null>(null);
  // Historical navigation keeps a bounded window separate from the live transcript store.
  const [view, setView] = useState<SessionHistoryLocation | null>(null);
  // Distinguish retrieval from an empty result and retain retry feedback.
  const [pending, setPending] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [error, setError] = useState('');
  // Refresh explicitly captures messages persisted since the previous search.
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const jumpRequest = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    request.current?.abort();jumpRequest.current?.abort();
    setOpen(false);setQuery('');setPage(null);setView(null);setPending(false);setJumping(false);setError('');
  }, []);
  useEffect(() => { close();return () => { request.current?.abort();jumpRequest.current?.abort(); }; }, [sessionId, close]);

  const fetchPage = useCallback(async (offset = 0, snapshot?: string) => {
    request.current?.abort();
    if (!sessionId || !query.trim()) return;
    const controller = new AbortController();request.current = controller;
    setPending(true);setError('');
    try {
      const result = await sessionHistorySearchApi.search(sessionId, query.trim(), offset, snapshot, controller.signal);
      if (!controller.signal.aborted) setPage(result);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }, [sessionId, query]);

  useEffect(() => {
    request.current?.abort();jumpRequest.current?.abort();setJumping(false);setPage(null);setError('');setPending(Boolean(open && query.trim()));
    if (!open || !query.trim()) return;
    const timer = setTimeout(() => { void fetchPage(); }, 250);
    return () => { clearTimeout(timer);request.current?.abort(); };
  }, [open, query, revision, fetchPage]);

  const jump = useCallback(async (snapshot: string, index: number) => {
    jumpRequest.current?.abort();if (!sessionId) return;
    const controller = new AbortController();jumpRequest.current = controller;
    setJumping(true);setError('');
    try {
      const result = await sessionHistorySearchApi.window(sessionId, snapshot, index, controller.signal);
      if (!controller.signal.aborted) setView({ ...result, query: query.trim() });
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!controller.signal.aborted) setJumping(false); }
  }, [sessionId, query]);
  const returnToChat = useCallback(() => { jumpRequest.current?.abort();setJumping(false);setView(null); }, []);
  return { open, setOpen, query, setQuery, page, view, pending, jumping, error, close, fetchPage, jump,
    returnToChat, refresh: () => setRevision(value => value + 1) };
}
