import { useEffect, useRef, useState } from 'react';

import { notesApi } from '@/shared/api';
import type { OutputNote, OutputNoteFilter, OutputNoteGroup } from '@/shared/types';

function dayKey(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function groupFilter(by: 'session' | 'date', key: string): OutputNoteFilter {
  if (!key) return {};
  if (by === 'session') return { sourceSessionId: key };
  const [year, month, day] = key.split('-').map(Number);
  return { from: new Date(year, month - 1, day).toISOString(), before: new Date(year, month - 1, day + 1).toISOString() };
}

/** NotesPanel uses saved source labels and local saving dates to browse the complete note library. */
export function NotesLibrary({ selectedId, onSelect, busy, version }: {
  selectedId?: string; onSelect: (note: OutputNote) => void; busy: boolean; version: number;
}) {
  // Remember the preferred classification while preserving the saved note metadata.
  const [by, setBy] = useState<'session' | 'date'>(() => {
    try { return localStorage.getItem('orbit-notes-grouping') === 'date' ? 'date' : 'session'; } catch { return 'session'; }
  });
  // Search covers the full library; a selected category limits its paginated results.
  const [search, setSearch] = useState('');
  // Empty selection shows all categories with section headings.
  const [group, setGroup] = useState('');
  // Bind category counts to their query so an older response stays hidden during a switch.
  const [catalog, setCatalog] = useState<{ key: string; groups: OutputNoteGroup[] }>({ key: '', groups: [] });
  // Pages are scoped to the selected saved source/day, including sources that have been removed.
  const [list, setList] = useState<{ key: string; notes: OutputNote[]; hasMore: boolean; nextOffset: number }>({ key: '', notes: [], hasMore: false, nextOffset: 0 });
  // A page request locks the controls until its results have been appended.
  const [paging, setPaging] = useState(false);
  // Fetch failures stay visible beside the category controls and retain the editor.
  const [error, setError] = useState('');
  const pageRequest = useRef<AbortController | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const catalogKey = JSON.stringify([by, search, version, timeZone]);
  const listKey = JSON.stringify([by, search, group, version]);
  const groups = catalog.key === catalogKey ? catalog.groups : [];
  const notes = list.key === listKey ? list.notes : [];
  const loading = catalog.key !== catalogKey || list.key !== listKey;

  useEffect(() => () => { pageRequest.current?.abort(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void notesApi.groups(by, search, timeZone, controller.signal).then(value => {
        if (!controller.signal.aborted) {
          setCatalog({ key: catalogKey, groups: value });
          setGroup(current => current && !value.some(item => item.key === current) ? '' : current);
        }
      }).catch(cause => { if (!controller.signal.aborted) { setCatalog({ key: catalogKey, groups: [] });setError(String(cause.message)); } });
    }, 150);
    return () => { clearTimeout(timer);controller.abort(); };
  }, [by, search, version, timeZone, catalogKey]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void notesApi.list(search, 0, controller.signal, groupFilter(by, group)).then(value => {
        if (!controller.signal.aborted) setList({ key: listKey, ...value });
      }).catch(cause => { if (!controller.signal.aborted) { setList({ key: listKey, notes: [], hasMore: false, nextOffset: 0 });setError(String(cause.message)); } });
    }, 150);
    return () => { clearTimeout(timer);controller.abort(); };
  }, [by, search, group, version, listKey]);

  const sections = new Map<string, { label: string; count: number; notes: OutputNote[] }>();
  for (const note of notes) {
    const key = by === 'session' ? note.sourceSessionId : dayKey(note.createdAt);
    let section = sections.get(key);
    if (!section) {
      const saved = groups.find(item => item.key === key);
      section = { label: saved?.label || (by === 'session' ? note.sourceTitle : key), count: saved?.count || 0, notes: [] };
      sections.set(key, section);
    }
    section.notes.push(note);
  }
  const locked = busy || paging;
  return <aside aria-label="笔记列表" className="flex min-h-0 flex-col gap-2 md:w-64 md:shrink-0">
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">{(['session', 'date'] as const).map(mode => <button key={mode} type="button" aria-pressed={by === mode} disabled={locked}
      className={`rounded-md px-3 py-1.5 text-xs ${by === mode ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
      onClick={() => { setBy(mode);setGroup('');setError('');try { localStorage.setItem('orbit-notes-grouping', mode); } catch { /* Classification remains available for this view. */ } }}>
      {mode === 'session' ? '按会话' : '按日期'}</button>)}</div>
    <select aria-label={by === 'session' ? '来源会话分类' : '保存日期分类'} disabled={locked} value={group}
      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" onChange={event => { setGroup(event.target.value);setError(''); }}>
      <option value="">{by === 'session' ? '所有会话' : '所有日期'}{groups.length ? ` · ${groups.reduce((sum, item) => sum + item.count, 0)} 条` : ''}</option>
      {groups.map(item => <option key={item.key} value={item.key}>{item.label} · {item.count} 条</option>)}
    </select>
    <input aria-label="搜索笔记" placeholder="搜索笔记、来源标签" disabled={locked} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      value={search} onChange={event => { setSearch(event.target.value);setGroup('');setError(''); }}/>
    <div className="max-h-44 space-y-3 overflow-y-auto md:max-h-none md:flex-1">
      {[...sections].map(([key, section]) => <section key={key} aria-label={section.label}>
        <button type="button" disabled={locked} title={by === 'session' ? `${section.label} · ${key}` : section.label}
          onClick={() => { setGroup(key);setError(''); }} className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground">
          <span className="min-w-0 flex-1 truncate">{section.label}</span><span className="shrink-0 tabular-nums">{section.count || section.notes.length}</span>
        </button>
        {section.notes.map(note => <button key={note.id} type="button" disabled={locked} onClick={() => onSelect(note)}
          className={`block w-full rounded-lg p-3 text-left ${selectedId === note.id ? 'bg-muted' : 'hover:bg-muted/60'}`}>
          <span className="block truncate text-sm font-medium">{note.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{note.sourceTitle}</span>
        </button>)}
      </section>)}
      {!notes.length && <p className="p-3 text-xs text-muted-foreground">{loading ? '正在读取笔记…' : search || group ? '当前分类中暂无匹配的笔记。' : '在回答中选中文字，点击“保存为笔记”即可收藏。'}</p>}
    </div>
    {list.key === listKey && list.hasMore && <button type="button" disabled={locked} className="text-xs text-primary" onClick={async () => {
      setPaging(true);setError('');const controller = new AbortController();pageRequest.current = controller;
      try {
        const page = await notesApi.list(search, list.nextOffset, controller.signal, groupFilter(by, group));
        if (!controller.signal.aborted) setList(previous => previous.key === listKey ? { ...page, key: listKey, notes: [...previous.notes, ...page.notes] } : previous);
      }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (!controller.signal.aborted) setPaging(false); }
    }}>{paging ? '正在读取…' : '加载更多笔记'}</button>}
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
  </aside>;
}
