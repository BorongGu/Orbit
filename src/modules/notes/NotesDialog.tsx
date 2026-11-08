import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Dialog, DialogContent } from '@/shared/ui/Dialog';
import { NotesPanel } from '@/modules/notes/NotesPanel';

/** Chat opens the saved selection in this library overlay while retaining the source transcript. */
export function NotesDialog({ noteId,onClose,onNavigate }: { noteId:string;onClose:()=>void;onNavigate?:(id:string)=>void }) {
  const navigate=useNavigate();
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent portalContainer={document.fullscreenElement || document.querySelector('[data-chat-reading-mode="true"]') || undefined} wrapperClassName="z-[120]" data-notes-dialog aria-label="笔记" className="flex h-[85dvh] w-[calc(100%_-_24px)] max-w-4xl flex-col gap-4 p-4"><header className="flex items-center justify-between"><strong>笔记</strong><button aria-label="关闭笔记" onClick={onClose}><X size={18}/></button></header><NotesPanel initialId={noteId} onNavigate={id=>{onClose();if(onNavigate)onNavigate(id);else navigate(`/session/${id}`);}}/></DialogContent></Dialog>;
}
