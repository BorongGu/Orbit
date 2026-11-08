import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, Plus, Trash2 } from 'lucide-react';

import { api, notesApi } from '@/shared/api';
import type { LLMProvider, OutputNote, Project } from '@/shared/types';
import { createClientRequestId } from '@/shared/utils';
import { ProviderModelPicker } from '@/shared/ui/ProviderModelPicker';

const FIELD = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';

/** NotesPage and the selection dialog share a searchable library and a one-click session action. */
export function NotesPanel({ initialId, onNavigate }: { initialId?: string; onNavigate: (sessionId: string) => void }) {
  // Persisted notes are fetched in searchable pages, while the selected editor keeps its own unsaved changes.
  const [list, setList] = useState<{ notes: OutputNote[]; hasMore: boolean; nextOffset: number }>({notes:[],hasMore:false,nextOffset:0});
  // Search text is local UI state; the backend searches the owner's full note collection.
  const [search, setSearch] = useState('');
  // Revision travels with the editor to protect edits made from another device.
  const [editor, setEditor] = useState<{ note: OutputNote; title: string; content: string; provider: LLMProvider; model: string; effort: string; projectPath: string } | null>(null);
  // Workspace choices let a note outlive its original project and seed a different project.
  const [projects, setProjects] = useState<Project[]>([]);
  // Request activity gates repeat clicks, and errors retain the note and selection for retry.
  const [activity, setActivity] = useState({loading:true,busy:false,error:'',saved:false});
  const launch = useRef<{fingerprint:string;id:string}|null>(null);
  const alive = useRef(true);
  const open = (note: OutputNote) => { setEditor({note,title:note.title,content:note.content,provider:note.sourceProvider,model:note.sourceModel||'',effort:'default',projectPath:note.sourceProjectPath||''});setActivity(value=>({...value,error:'',saved:false}));launch.current=null; };
  useEffect(() => {
    alive.current=true; const controller=new AbortController();
    if(initialId) void notesApi.read(initialId,controller.signal).then(note=>{if(!controller.signal.aborted)open(note);}).catch(error=>{if(!controller.signal.aborted)setActivity(value=>({...value,error:String(error.message)}));});
    void api.projects().then(async response=>{if(response.ok){const values=await response.json();if(alive.current)setProjects(values);}}).catch(()=>{});
    return()=>{alive.current=false;controller.abort();};
  },[initialId]);
  useEffect(()=>{
    const controller=new AbortController();setActivity(value=>({...value,loading:true}));
    const timer=setTimeout(()=>{void notesApi.list(search,0,controller.signal).then(value=>{if(!controller.signal.aborted){setList(value);setActivity(previous=>({...previous,loading:false}));}}).catch(error=>{if(!controller.signal.aborted)setActivity(value=>({...value,loading:false,error:String(error.message)}));});},150);
    return()=>{clearTimeout(timer);controller.abort();};
  },[search]);
  const save = async () => {
    if(!editor)return null;
    if(editor.title===editor.note.title&&editor.content===editor.note.content)return editor.note;
    const note=await notesApi.update(editor.note.id,{title:editor.title,content:editor.content,revision:editor.note.revision});
    if(alive.current){setEditor(value=>value?.note.id===note.id?{...value,note}:value);setList(value=>({...value,notes:value.notes.map(item=>item.id===note.id?note:item)}));}
    return note;
  };
  const operation = async (run:()=>Promise<void>) => {
    setActivity(value=>({...value,busy:true,error:'',saved:false}));
    try{await run();}catch(error){if(alive.current)setActivity(value=>({...value,error:error instanceof Error?error.message:String(error)}));}
    finally{if(alive.current)setActivity(value=>({...value,busy:false}));}
  };
  return <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
    <aside className="flex min-h-0 flex-col gap-2 md:w-64 md:shrink-0"><input aria-label="搜索笔记" placeholder="搜索笔记" className={FIELD} value={search} onChange={event=>setSearch(event.target.value)}/>
      <div className="max-h-44 space-y-1 overflow-y-auto md:max-h-none md:flex-1">{list.notes.map(note=><button key={note.id} disabled={activity.busy} onClick={()=>open(note)} className={`block w-full rounded-lg p-3 text-left ${editor?.note.id===note.id?'bg-muted':'hover:bg-muted/60'}`}><span className="block truncate text-sm font-medium">{note.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{note.sourceTitle}</span></button>)}{!list.notes.length&&<p className="p-3 text-xs text-muted-foreground">{activity.loading?'正在读取笔记…':'在回答中选中文字，点击“保存为笔记”即可收藏。'}</p>}</div>
      {list.hasMore&&<button disabled={activity.busy} className="text-xs text-primary" onClick={()=>void operation(async()=>{const page=await notesApi.list(search,list.nextOffset);if(alive.current)setList(previous=>({...page,notes:[...previous.notes,...page.notes]}));})}>加载更多笔记</button>}
    </aside>
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto">{editor?<fieldset disabled={activity.busy} className="space-y-3">
      <input aria-label="笔记标题" maxLength={200} className={FIELD} value={editor.title} onChange={event=>setEditor({...editor,title:event.target.value})}/>
      <textarea aria-label="笔记内容" maxLength={32000} rows={10} className={`${FIELD} min-h-36 leading-relaxed`} value={editor.content} onChange={event=>setEditor({...editor,content:event.target.value})}/>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><Link to={`/session/${encodeURIComponent(editor.note.sourceSessionId)}`} onClick={event=>{event.preventDefault();onNavigate(editor.note.sourceSessionId);}} className="flex items-center gap-1 text-primary">来源：{editor.note.sourceTitle}<ArrowUpRight size={12}/></Link><span>{editor.note.sourceProvider} · {new Date(editor.note.createdAt).toLocaleString()}</span></div>
      {editor.note.content!==editor.note.excerpt&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer">原始摘录</summary><pre className="mt-2 whitespace-pre-wrap font-sans">{editor.note.excerpt}</pre></details>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!editor.title.trim()||!editor.content.trim()} className="rounded-lg border border-border px-3 py-2 text-sm" onClick={()=>void operation(async()=>{await save();if(alive.current)setActivity(value=>({...value,saved:true}));})}>保存修改</button>
        <button type="button" disabled={!editor.title.trim()||!editor.content.trim()} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={()=>void operation(async()=>{
          const note=await save();if(!note)return;
          const choice={provider:editor.provider,...(editor.model?{model:editor.model}:{}),effort:editor.effort,...(editor.projectPath?{projectPath:editor.projectPath}:{})};
          const fingerprint=JSON.stringify({id:note.id,revision:note.revision,...choice});if(launch.current?.fingerprint!==fingerprint)launch.current={fingerprint,id:createClientRequestId()};
          const result=await notesApi.createSession(note.id,{...choice,requestId:launch.current.id});if(alive.current)onNavigate(result.sessionId);
        })}><Plus size={15}/>用此笔记开启新会话</button>
        <button type="button" aria-label="删除笔记" className="ml-auto rounded-lg px-2 text-muted-foreground hover:text-red-500" onClick={()=>void operation(async()=>{await notesApi.remove(editor.note.id);if(alive.current){setList(value=>({...value,notes:value.notes.filter(note=>note.id!==editor.note.id)}));setEditor(null);}})}><Trash2 size={16}/></button></div>
      <p className="text-xs text-muted-foreground">新会话会带上这份笔记作为初始背景，在你发送第一条消息时读取。</p>
      <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs">新会话设置 · {editor.provider}</summary><div className="mt-3 space-y-3"><select aria-label="笔记新会话 Harness" className={FIELD} value={editor.provider} onChange={event=>setEditor({...editor,provider:event.target.value as LLMProvider,model:'',effort:'default'})}>{['claude','codex','opencode','cursor'].map(provider=><option key={provider}>{provider}</option>)}</select>
        <ProviderModelPicker provider={editor.provider} model={editor.model} effort={editor.effort} label="笔记新会话模型" onChange={(model,effort)=>setEditor(value=>value?{...value,model,effort}:value)}/>
        <select aria-label="笔记新会话项目" className={FIELD} value={editor.projectPath} onChange={event=>setEditor({...editor,projectPath:event.target.value})}><option value={editor.note.sourceProjectPath||''}>原会话工作目录{editor.note.sourceProjectPath?` · ${editor.note.sourceProjectPath}`:''}</option>{projects.filter(project=>(project.fullPath||project.path)!==editor.note.sourceProjectPath).map(project=><option key={project.projectId} value={project.fullPath||project.path}>{project.displayName||project.fullPath||project.path}</option>)}</select></div></details>
    </fieldset>:<div className="flex h-full min-h-36 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><BookOpen size={28}/><p>选择一份笔记，继续整理或开启新会话。</p></div>}
    {activity.saved&&<p role="status" className="mt-3 text-xs text-primary">笔记已保存。</p>}{activity.error&&<p role="alert" className="mt-3 text-sm text-red-500">{activity.error}</p>}</section>
  </div>;
}
