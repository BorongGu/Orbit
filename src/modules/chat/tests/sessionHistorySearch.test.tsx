import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useSessionHistorySearch } from '@/modules/chat/hooks/useSessionHistorySearch';
import { sessionHistorySearchApi } from '@/shared/api';
import type { SessionMessageSearchPage, SessionMessageWindow } from '@/shared/types';

const page: SessionMessageSearchPage = { snapshot: 'snapshot', total: 1, offset: 0, hasMore: false, hits: [{ index: 1000, messageId: 'target', role: 'assistant', timestamp: '2026-01-01', snippet: 'exact hit' }] };
afterEach(() => { cleanup();vi.useRealTimers();vi.restoreAllMocks(); });
test('typing debounces full-history searches and a session switch discards late responses', async () => {
  vi.useFakeTimers();let resolve!: (value: SessionMessageSearchPage) => void;
  const search = vi.spyOn(sessionHistorySearchApi, 'search').mockImplementation(() => new Promise(done => { resolve = done; }));
  const hook = renderHook(({ id }) => useSessionHistorySearch(id), { initialProps: {id: 'one'} });
  act(() => { hook.result.current.setOpen(true);hook.result.current.setQuery('ex'); });
  await act(async () => { vi.advanceTimersByTime(200); });expect(search).not.toHaveBeenCalled();
  act(() => { hook.result.current.setQuery('exact'); });
  await act(async () => { vi.advanceTimersByTime(250); });expect(search).toHaveBeenCalledTimes(1);
  hook.rerender({id: 'two'});
  await act(async () => { resolve(page); });
  expect(search.mock.calls[0][4]?.aborted).toBe(true);expect(hook.result.current.page).toBeNull();expect(hook.result.current.open).toBe(false);
});
test('jump uses the immutable snapshot and closing cancels an outstanding location request', async () => {
  let resolve!: (value: SessionMessageWindow) => void;
  const window = vi.spyOn(sessionHistorySearchApi, 'window').mockImplementation(() => new Promise(done => { resolve = done; }));
  const hook = renderHook(() => useSessionHistorySearch('one'));
  act(() => { void hook.result.current.jump('snapshot', 1000); });
  expect(window.mock.calls[0].slice(0,3)).toEqual(['one','snapshot',1000]);
  act(() => hook.result.current.close());
  await act(async () => { resolve({ snapshot:'snapshot',index:1000,start:985,end:1016,total:2000,messages:[] }); });
  expect(window.mock.calls[0][3]?.aborted).toBe(true);expect(hook.result.current.view).toBeNull();
});
