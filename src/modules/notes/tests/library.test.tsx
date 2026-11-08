import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { NotesLibrary } from '@/modules/notes/NotesLibrary';
import { notesApi } from '@/shared/api';
import type { OutputNote } from '@/shared/types';

vi.mock('@/shared/api', () => ({ notesApi: { groups: vi.fn(), list: vi.fn() } }));
const note: OutputNote = { id: 'old', title: 'Existing note', content: 'Saved text', excerpt: 'Saved text',
  sourceSessionId: 'archived-source', sourceMessageId: 'answer', sourceAnchorId: null, sourceKind: 'session', sourceConversationId: null,
  sourceTitle: 'Saved session label', sourceProvider: 'codex', sourceModel: null, sourceProjectPath: '/workspace',
  createdAt: '2026-11-08T12:00:00.000Z', updatedAt: '2026-11-08T12:00:00.000Z', revision: 1 };
const other: OutputNote = { ...note, id: 'other', title: 'Other saved note', sourceSessionId: 'deleted-source', sourceTitle: 'Another saved label', createdAt: '2026-11-09T12:00:00.000Z' };

beforeEach(() => {
  vi.resetAllMocks();localStorage.removeItem('orbit-notes-grouping');
  vi.mocked(notesApi.groups).mockImplementation(async by => by === 'session'
    ? [{ key: 'archived-source', label: note.sourceTitle, count: 1 }, { key: 'deleted-source', label: other.sourceTitle, count: 1 }]
    : [{ key: '2026-11-09', label: '2026-11-09', count: 1 }, { key: '2026-11-08', label: '2026-11-08', count: 1 }]);
  vi.mocked(notesApi.list).mockImplementation(async (_search, _offset, _signal, filter = {}) => {
    const notes = [other, note].filter(value => (!filter.sourceSessionId || value.sourceSessionId === filter.sourceSessionId)
      && (!filter.from || Date.parse(value.createdAt) >= Date.parse(filter.from)) && (!filter.before || Date.parse(value.createdAt) < Date.parse(filter.before)));
    return { notes, hasMore: false, nextOffset: notes.length };
  });
});

it('classifies existing notes by their saved source labels and filters archived/deleted source ids', async () => {
  const open = vi.fn();render(<NotesLibrary busy={false} version={0} onSelect={open}/>);
  const section = await screen.findByRole('region', { name: note.sourceTitle });
  fireEvent.click(within(section).getByTitle(`${note.sourceTitle} · ${note.sourceSessionId}`));
  await waitFor(() => expect(notesApi.list).toHaveBeenLastCalledWith('', 0, expect.any(AbortSignal), { sourceSessionId: note.sourceSessionId }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /Other saved note/ })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /Existing note/ }));expect(open).toHaveBeenCalledWith(note);
  fireEvent.change(screen.getByLabelText('来源会话分类'), { target: { value: other.sourceSessionId } });
  await screen.findByRole('button', { name: /Other saved note/ });
  expect(notesApi.list).toHaveBeenLastCalledWith('', 0, expect.any(AbortSignal), { sourceSessionId: other.sourceSessionId });
});

it('switches to local saving dates, requests the whole local day, and remembers the classification', async () => {
  const view = render(<NotesLibrary busy={false} version={0} onSelect={() => {}}/>);
  fireEvent.click(screen.getByRole('button', { name: '按日期' }));
  await screen.findByRole('option', { name: '2026-11-08 · 1 条' });
  fireEvent.change(screen.getByLabelText('保存日期分类'), { target: { value: '2026-11-08' } });
  await waitFor(() => expect(notesApi.list).toHaveBeenLastCalledWith('', 0, expect.any(AbortSignal), {
    from: new Date(2026, 10, 8).toISOString(), before: new Date(2026, 10, 9).toISOString(),
  }));
  await screen.findByRole('button', { name: /Existing note/ });
  expect(localStorage.getItem('orbit-notes-grouping')).toBe('date');
  view.unmount();render(<NotesLibrary busy={false} version={0} onSelect={() => {}}/>);
  expect(screen.getByRole('button', { name: '按日期' }).getAttribute('aria-pressed')).toBe('true');
});

it('paginates inside one source category while showing its full saved note count', async () => {
  const notes = Array.from({ length: 51 }, (_, index) => ({ ...note, id: `saved-${index}`, title: `Saved ${index}` }));
  vi.mocked(notesApi.groups).mockResolvedValue([{ key: note.sourceSessionId, label: note.sourceTitle, count: notes.length }]);
  vi.mocked(notesApi.list).mockImplementation(async (_query, offset = 0) => ({ notes: notes.slice(offset, offset + 50), nextOffset: Math.min(offset + 50, notes.length), hasMore: offset === 0 }));
  render(<NotesLibrary busy={false} version={0} onSelect={() => {}}/>);
  await screen.findByRole('option', { name: `${note.sourceTitle} · 51 条` });
  fireEvent.change(screen.getByLabelText('来源会话分类'), { target: { value: note.sourceSessionId } });
  await waitFor(() => expect(notesApi.list).toHaveBeenLastCalledWith('', 0, expect.any(AbortSignal), { sourceSessionId: note.sourceSessionId }));
  fireEvent.click(await screen.findByRole('button', { name: '加载更多笔记' }));
  await screen.findByRole('button', { name: /Saved 50 / });
  expect(notesApi.list).toHaveBeenLastCalledWith('', 50, expect.any(AbortSignal), { sourceSessionId: note.sourceSessionId });
  expect(screen.queryByRole('button', { name: '加载更多笔记' })).toBeNull();
});

it('keeps a newer search visible when an older response arrives later', async () => {
  let release!: (value: { notes: OutputNote[]; hasMore: boolean; nextOffset: number }) => void;
  vi.mocked(notesApi.list).mockImplementation(async query => query === 'earlier'
    ? new Promise(resolve => { release = resolve; }) : { notes: [other], hasMore: false, nextOffset: 1 });
  render(<NotesLibrary busy={false} version={0} onSelect={() => {}}/>);
  fireEvent.change(screen.getByLabelText('搜索笔记'), { target: { value: 'earlier' } });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.change(screen.getByLabelText('搜索笔记'), { target: { value: 'latest' } });
  await screen.findByRole('button', { name: /Other saved note/ });
  await act(async () => release({ notes: [note], hasMore: false, nextOffset: 1 }));
  expect(screen.queryByRole('button', { name: /Existing note/ })).toBeNull();
});
