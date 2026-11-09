import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RotateCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { useSessionHistorySearch } from '@/modules/chat/hooks/useSessionHistorySearch';

function Snippet({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.trim().toLowerCase());
  return index < 0 ? <>{text}</> : <>{text.slice(0, index)}<mark className="rounded bg-primary/20 text-inherit">{text.slice(index, index + query.trim().length)}</mark>{text.slice(index + query.trim().length)}</>;
}

/** ChatInterface's compact history controls expose paged snippets and keep the chosen dialogue visible below. */
export function SessionHistorySearchBar({ search }: { search: ReturnType<typeof useSessionHistorySearch> }) {
  const { t } = useTranslation('chat');
  const input = useRef<HTMLInputElement>(null);
  // Selecting a result makes room for its dialogue; the list remains one click away.
  const [showResults, setShowResults] = useState(true);
  useEffect(() => { if (search.open) input.current?.focus(); }, [search.open]);
  useEffect(() => { setShowResults(true); }, [search.query]);
  if (!search.open) return null;
  const page = search.page;
  return <section data-history-search className="shrink-0 border-b border-border/60 bg-background/95 px-3 py-2" aria-label={t('historySearch.title')}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();search.close(); } }}>
    <div className="flex items-center gap-2">
      <input ref={input} value={search.query} maxLength={200} onChange={event => search.setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && page?.hits[0]) { event.preventDefault();input.current?.blur();void search.jump(page.snapshot, page.hits[0].index);setShowResults(false); } }}
        aria-label={t('historySearch.placeholder')} placeholder={t('historySearch.placeholder')}
        className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-primary/60" />
      <button type="button" onClick={search.refresh} aria-label={t('historySearch.refresh')} title={t('historySearch.refresh')} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><RotateCw className="h-4 w-4" /></button>
      <button type="button" onClick={search.close} aria-label={t('historySearch.close')} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
    </div>
    <div className="mt-1 flex min-h-6 flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {(search.pending || search.jumping) && <span role="status" className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{t(search.jumping ? 'historySearch.jumping' : 'historySearch.searching')}</span>}
      {!search.pending && page && <span role="status">{t('historySearch.count', { count: page.total })}</span>}
      {!search.query.trim() && <span>{t('historySearch.hint')}</span>}
      {page && page.total > 0 && <button type="button" onClick={() => setShowResults(value => !value)} className="underline underline-offset-2">{t(showResults ? 'historySearch.hideResults' : 'historySearch.showResults')}</button>}
      {search.view && <button type="button" onClick={search.returnToChat} className="ml-auto rounded px-2 py-1 text-primary hover:bg-primary/10">{t('historySearch.back')}</button>}
    </div>
    {search.error && <p role="alert" className="py-1 text-xs text-muted-foreground">{search.error}</p>}
    {showResults && page && <>
      <div className="max-h-48 space-y-1 overflow-y-auto overscroll-contain" aria-label={t('historySearch.results')}>
        {page.hits.map(hit => <button key={hit.index} type="button" disabled={search.jumping} onClick={() => { input.current?.blur();void search.jump(page.snapshot, hit.index);setShowResults(false); }}
          className="block w-full rounded-md px-2 py-2 text-left text-xs hover:bg-muted focus-visible:ring-1 focus-visible:ring-primary" aria-current={search.view?.snapshot === page.snapshot && search.view.index === hit.index ? 'true' : undefined}>
          <span className="mb-1 block text-[10px] text-muted-foreground">{t(hit.role === 'user' ? 'historySearch.user' : 'historySearch.assistant')} · {Number.isFinite(Date.parse(hit.timestamp)) ? new Date(hit.timestamp).toLocaleString() : ''}</span>
          <span className="line-clamp-2 break-words"><Snippet text={hit.snippet} query={search.query} /></span>
        </button>)}
      </div>
      {(page.offset > 0 || page.hasMore) && <div className="flex justify-end gap-2 pt-1 text-xs">
        <button type="button" disabled={search.pending || page.offset === 0} aria-label={t('historySearch.previous')} onClick={() => { void search.fetchPage(Math.max(0, page.offset - 40), page.snapshot); }} className="rounded p-1 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
        <span>{page.offset + 1}–{page.offset + page.hits.length} / {page.total}</span>
        <button type="button" disabled={search.pending || !page.hasMore} aria-label={t('historySearch.next')} onClick={() => { void search.fetchPage(page.offset + 40, page.snapshot); }} className="rounded p-1 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
      </div>}
    </>}
  </section>;
}
