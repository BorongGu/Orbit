import { useEffect, useState } from 'react';

import { notesApi } from '@/shared/api';
import type { NoteSessionContext } from '@/shared/types';

/** Chat displays the immutable note that was included when this session was created. */
export function NoteContextBanner({ sessionId, busy }: { sessionId: string | null; busy: boolean }) {
  // Bind the frozen context to its session so late responses cannot leak into a different conversation.
  const [context,setContext]=useState<NoteSessionContext|null>(null);
  useEffect(()=>{
    if(!sessionId)return;const controller=new AbortController();
    void notesApi.sessionContext(sessionId,controller.signal).then(value=>{if(!controller.signal.aborted)setContext(value);}).catch(()=>{});
    return()=>controller.abort();
  },[sessionId,busy]);
  if(!context||context.sessionId!==sessionId)return null;
  return <details className="mx-3 my-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">初始笔记 · {context.note.title}</summary><p className="mt-2 text-muted-foreground">{context.status==='pending'?'发送第一条消息时，这份笔记会作为背景一并交给 agent。':context.status==='uncertain'?'投递状态待确认，可查看本会话记录。':'这份笔记已加入本会话的初始上下文。'}</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans leading-relaxed">{context.note.content}</pre></details>;
}
