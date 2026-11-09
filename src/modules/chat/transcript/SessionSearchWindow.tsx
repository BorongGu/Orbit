import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import type { SessionHistoryLocation } from '@/shared/types';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import { useLazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import LazyMessageRow from '@/modules/chat/transcript/LazyMessageRow';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';

function locateText(element: HTMLElement, query: string): Range | null {
  if (!query) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
  let text = '', node: Node | null;
  while ((node = walker.nextNode())) {
    if ((node.parentElement)?.closest('.katex-mathml, button, [aria-hidden="true"]')) continue;
    nodes.push(node as Text);text += node.textContent || '';
  }
  const start = text.toLowerCase().indexOf(query.toLowerCase());
  if (start < 0) return null;
  const range = document.createRange();let offset = 0, started = false;
  for (const node of nodes) {
    const length = node.length;
    if (!started && start < offset + length) { range.setStart(node, start - offset);started = true; }
    if (started && start + query.length <= offset + length) { range.setEnd(node, start + query.length - offset);return range; }
    offset += length;
  }
  return null;
}

type Props = { view: SessionHistoryLocation; onPage: (snapshot: string, index: number) => void; busy: boolean }
  & Pick<ComponentProps<typeof MessageComponent>, 'createDiff' | 'onFileOpen' | 'onShowSettings' | 'onGrantToolPermission' | 'showRawParameters' | 'showThinking' | 'selectedProject' | 'provider'>;

/** A search hit replaces the live viewport with at most 31 dialogue messages; ordinal wrappers give exact stable jumps. */
export const SessionSearchWindow = memo(function SessionSearchWindow({ view, onPage, busy, ...messageProps }: Props) {
  const { t } = useTranslation('chat');
  const container = useRef<HTMLDivElement>(null);
  const lazyRows = useLazyRowObserver(container);
  const rows = useMemo(() => view.messages.map(message => normalizedToChatMessages([message])), [view.messages]);
  useLayoutEffect(() => {
    const node = container.current, target = node?.querySelector<HTMLElement>('[data-search-target="true"]');
    if (!node || !target) return;
    // Keep the hit aligned while nearby lazy rows recover their measured heights.
    let frame = 0, raf = 0;
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const Highlight = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const align = () => {
      const match = locateText(target, view.query);
      if (match && registry && Highlight) registry.set('session-search-hit', new Highlight(match));
      const rect = match?.getBoundingClientRect() ?? target.getBoundingClientRect();
      node.scrollTop += rect.top - node.getBoundingClientRect().top - 80;
      if (++frame < 4) raf = requestAnimationFrame(align);
    };
    raf = requestAnimationFrame(align);
    const stop = () => cancelAnimationFrame(raf);
    node.addEventListener('wheel', stop, { passive: true });node.addEventListener('touchstart', stop, { passive: true });
    return () => { stop();registry?.delete('session-search-hit');node.removeEventListener('wheel', stop);node.removeEventListener('touchstart', stop); };
  }, [view]);
  return <div ref={container} className="chat-messages-pane min-h-0 flex-1 overflow-y-auto overscroll-contain" data-history-window>
    <div className="chat-transcript-content chat-content-width mx-auto w-full px-4 py-3">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground"><span>{t('historySearch.position', { index: view.index + 1, total: view.total })}</span>
        {view.start > 0 && <button type="button" disabled={busy} onClick={() => onPage(view.snapshot, Math.max(0, view.start - 15))} className="rounded px-2 py-1 hover:bg-muted">{t('historySearch.earlier')}</button>}
      </div>
      {rows.map((messages, offset) => <div key={`${view.snapshot}:${view.start + offset}`} data-search-target={view.start + offset === view.index ? 'true' : undefined}
        className={view.start + offset === view.index ? 'my-2 rounded-md bg-primary/5 ring-1 ring-primary/40' : undefined}>
        <LazyMessageRow lazyRows={lazyRows} timestamp={view.messages[offset].timestamp} initiallyNearViewport={Math.abs(view.start + offset - view.index) <= 2}>
          {messages.map((message, index) => <MessageComponent key={index} {...messageProps} message={message} prevMessage={messages[index - 1] ?? rows[offset - 1]?.at(-1)} />)}
        </LazyMessageRow>
      </div>)}
      {view.end < view.total && <button type="button" disabled={busy} onClick={() => onPage(view.snapshot, Math.min(view.total - 1, view.end + 14))} className="my-3 w-full rounded py-2 text-xs text-muted-foreground hover:bg-muted">{t('historySearch.later')}</button>}
    </div>
  </div>;
});
