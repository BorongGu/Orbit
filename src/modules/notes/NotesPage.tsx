import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';

import { NotesPanel } from '@/modules/notes/NotesPanel';

/** App's /notes route is the cross-session library of saved output selections. */
export function NotesPage() {
  const navigate=useNavigate();const [params]=useSearchParams();
  return <div className="flex h-dvh flex-col bg-background text-foreground"><header className="flex items-center gap-3 border-b border-border px-4 py-3"><Link to="/" className="flex items-center gap-1 text-sm"><ArrowLeft size={16}/>Orbit</Link><BookOpen size={17}/><strong>笔记</strong></header><main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 p-4 md:p-6"><NotesPanel initialId={params.get('note')||undefined} onNavigate={id=>navigate(`/session/${id}`)}/></main></div>;
}
