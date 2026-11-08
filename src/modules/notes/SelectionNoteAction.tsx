import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check } from 'lucide-react';

import { notesApi } from '@/shared/api';
import type { NoteSelectionInput } from '@/shared/types';
import { createClientRequestId, serializeSelectionRange } from '@/shared/utils';

/** Chat mounts one selection listener per transcript, including reading, BTW and group-member views. */
export function SelectionNoteAction({ root, sessionId, onOpenNote, conversationId, sourceModel }: { root: RefObject<HTMLElement>; sessionId: string | null; onOpenNote: (id: string) => void; conversationId?: string; sourceModel?: string }) {
  // Capture a rendered quote and position before clicking the toolbar collapses the browser selection.
  const [selection, setSelection] = useState<{ input: NoteSelectionInput; top: number; left: number } | null>(null);
  // Keep a failed save retryable, and show a direct route to the newly saved note.
  const [save, setSave] = useState<{ busy: boolean; noteId?: string; error?: string }>({ busy: false });
  const request = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; setSelection(null); setSave({ busy: false }); request.current = null;
    const capture = () => {
      const selected = window.getSelection();
      if (!sessionId || !selected || selected.isCollapsed || selected.rangeCount !== 1) { setSelection(null); return; }
      const range = selected.getRangeAt(0);
      const element = (node: Node) => node instanceof Element ? node : node.parentElement;
      const start = element(range.startContainer)?.closest<HTMLElement>('[data-note-message]');
      const end = element(range.endContainer)?.closest('[data-note-message]');
      if (!start || start !== end || !root.current?.contains(start)) { setSelection(null); return; }
      const content = serializeSelectionRange(range).text.trim();
      if (!content) { setSelection(null); return; }
      const signature = JSON.stringify([sessionId,conversationId,start.dataset.noteMessage,content]);
      if (request.current?.signature !== signature) { request.current = { signature,id: createClientRequestId() }; setSave({ busy:false }); }
      const rect = range.getBoundingClientRect();
      setSelection({ input: { requestId: request.current.id, content, sourceSessionId: sessionId, sourceMessageId: start.dataset.noteMessage!,
        ...(start.dataset.noteAnchor ? { sourceAnchorId: start.dataset.noteAnchor } : {}), ...(start.dataset.noteModel || sourceModel ? { sourceModel: start.dataset.noteModel || sourceModel } : {}),
        ...(conversationId ? { sourceKind: 'btw', sourceConversationId: conversationId } : {}) },
        left: Math.max(8,Math.min(rect.left,window.innerWidth-200)),top: Math.max(8,Math.min(rect.bottom+8,window.innerHeight-70)) });
    };
    const dismiss = (event: KeyboardEvent) => {
      const selected = window.getSelection();
      if (event.key === 'Escape' && selected?.anchorNode && root.current?.contains(selected.anchorNode)) {
        event.preventDefault(); event.stopPropagation(); selected.removeAllRanges(); setSelection(null);
      }
    };
    document.addEventListener('keydown',dismiss);
    document.addEventListener('selectionchange',capture);document.addEventListener('fullscreenchange',capture);document.addEventListener('pointerup',capture);document.addEventListener('keyup',capture);
    window.addEventListener('resize',capture);document.addEventListener('scroll',capture,true);
    return () => { mounted.current = false; document.removeEventListener('keydown',dismiss);document.removeEventListener('selectionchange',capture);document.removeEventListener('fullscreenchange',capture);document.removeEventListener('pointerup',capture);document.removeEventListener('keyup',capture);window.removeEventListener('resize',capture);document.removeEventListener('scroll',capture,true); };
  },[root,sessionId,conversationId,sourceModel]);
  if (!selection) return null;
  return createPortal(<div data-note-toolbar className="fixed z-[110] max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg" style={{top:selection.top,left:selection.left}} onPointerDown={event => event.preventDefault()} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();window.getSelection()?.removeAllRanges();setSelection(null);}}}>
    <button type="button" disabled={save.busy} className="flex items-center gap-2 rounded px-2 py-1 text-sm disabled:opacity-50" onClick={async () => {
      if (save.noteId) { onOpenNote(save.noteId); window.getSelection()?.removeAllRanges(); return; }
      const current = selection.input;setSave({busy:true});
      try { const note = await notesApi.create(current);if (mounted.current && request.current?.id === current.requestId) setSave({busy:false,noteId:note.id}); }
      catch (error) { if (mounted.current && request.current?.id === current.requestId) setSave({busy:false,error:error instanceof Error?error.message:String(error)}); }
    }}>{save.noteId ? <Check size={15}/> : <BookOpen size={15}/>} {save.busy?'正在保存…':save.noteId?'已保存 · 查看笔记':'保存为笔记'}</button>
    {save.error && <p role="alert" className="max-w-64 px-2 text-xs text-red-500">{save.error}</p>}
  </div>,document.fullscreenElement || document.querySelector('[data-chat-reading-mode="true"]') || document.body);
}
