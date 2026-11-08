import { act,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,expect,it,vi } from 'vitest';

import '@/modules/i18n';
import { api,notesApi } from '@/shared/api';
import type { OutputNote } from '@/shared/types';
import { NotesPanel } from '@/modules/notes/NotesPanel';
import { SelectionNoteAction } from '@/modules/notes/SelectionNoteAction';
import { NotesDialog } from '@/modules/notes/NotesDialog';

vi.mock('@/shared/api',()=>({api:{projects:vi.fn(),providers:{models:vi.fn()}},notesApi:{create:vi.fn(),read:vi.fn(),list:vi.fn(),update:vi.fn(),remove:vi.fn(),createSession:vi.fn()}}));
const note:OutputNote={id:'note',title:'Selected idea',content:'First paragraph.\n\nSecond paragraph.',excerpt:'First paragraph.\n\nSecond paragraph.',sourceSessionId:'source',sourceMessageId:'answer',sourceAnchorId:'anchor',sourceKind:'session',sourceConversationId:null,sourceTitle:'Research',sourceProvider:'codex',sourceModel:'model',sourceProjectPath:'/workspace',createdAt:'2026-11-08T12:00:00Z',updatedAt:'2026-11-08T12:00:00Z',revision:1};
beforeEach(()=>{
  vi.clearAllMocks();window.getSelection()?.removeAllRanges();
  vi.mocked(notesApi.create).mockResolvedValue(note);vi.mocked(notesApi.read).mockResolvedValue(note);
  vi.mocked(notesApi.list).mockResolvedValue({notes:[note],hasMore:false,nextOffset:1});
  vi.mocked(notesApi.createSession).mockResolvedValue({sessionId:'new-session'});
  vi.mocked(notesApi.update).mockImplementation(async(_id,input)=>({...note,...input,revision:input.revision+1}));
  vi.mocked(api.projects).mockResolvedValue(new Response(JSON.stringify([{projectId:'workspace',fullPath:'/workspace',displayName:'Workspace'}])));
  vi.mocked(api.providers.models).mockResolvedValue(new Response(JSON.stringify({success:true,data:{models:{DEFAULT:'model',OPTIONS:[{value:'model',label:'Frontier'}]}}})));
  Range.prototype.getBoundingClientRect=()=>({x:10,y:10,left:10,right:200,top:10,bottom:40,width:190,height:30,toJSON(){}});
});
function Selectable({sessionId='source',onOpenNote=()=>{}}:{sessionId?:string;onOpenNote?:(id:string)=>void}){
  const root=useRef<HTMLDivElement>(null);
  return <><div ref={root}><div data-note-message="answer" data-note-anchor="anchor" data-note-model="model"><p>First paragraph.</p><p>Second paragraph.</p></div><div data-note-message="another">Another answer.</div><textarea aria-label="composer" defaultValue="Draft"/></div><SelectionNoteAction root={root} sessionId={sessionId} onOpenNote={onOpenNote}/></>;
}
function select(element:Element,end?:Node){const range=document.createRange();range.selectNodeContents(element);if(end)range.setEndAfter(end);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);fireEvent(document,new Event('selectionchange'));}

it('saves a multi-paragraph rendered selection with provenance and reuses the key on a failed retry',async()=>{
  vi.mocked(notesApi.create).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(note);
  const open=vi.fn();render(<Selectable onOpenNote={open}/>);
  act(()=>select(document.querySelector('[data-note-message="answer"]')!));
  fireEvent.click(screen.getByRole('button',{name:'保存为笔记'}));await screen.findByText('offline');
  fireEvent.click(screen.getByRole('button',{name:'保存为笔记'}));await screen.findByRole('button',{name:'已保存 · 查看笔记'});
  expect(vi.mocked(notesApi.create).mock.calls[0]).toEqual(vi.mocked(notesApi.create).mock.calls[1]);
  expect(notesApi.create).toHaveBeenCalledWith(expect.objectContaining({content:note.content,sourceSessionId:'source',sourceMessageId:'answer',sourceAnchorId:'anchor'}));
  fireEvent.click(screen.getByRole('button',{name:'已保存 · 查看笔记'}));expect(open).toHaveBeenCalledWith('note');
});

it('selection boundaries exclude multiple answers and clear on session navigation',()=>{
  const view=render(<Selectable/>);
  act(()=>select(document.querySelector('[data-note-message="answer"]')!,document.querySelector('[data-note-message="another"]')!));
  expect(screen.queryByRole('button',{name:'保存为笔记'})).toBeNull();
  act(()=>select(document.querySelector('[data-note-message="answer"]')!));expect(screen.getByRole('button',{name:'保存为笔记'})).toBeTruthy();
  view.rerender(<Selectable sessionId="different"/>);expect(screen.queryByRole('button',{name:'保存为笔记'})).toBeNull();
});

it('one click seeds a new session and saves current note edits before taking the initial snapshot',async()=>{
  const navigate=vi.fn();render(<MemoryRouter><NotesPanel initialId="note" onNavigate={navigate}/></MemoryRouter>);
  const content=await screen.findByLabelText('笔记内容');fireEvent.change(content,{target:{value:'Refined conclusion'}});
  fireEvent.click(screen.getByRole('button',{name:'用此笔记开启新会话'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('new-session'));
  expect(notesApi.update).toHaveBeenCalledWith('note',{title:note.title,content:'Refined conclusion',revision:1});
  expect(notesApi.createSession).toHaveBeenCalledWith('note',expect.objectContaining({provider:'codex',model:'model',projectPath:'/workspace',requestId:expect.any(String)}));
});

it('a failed session creation retains its idempotency key and the note content',async()=>{
  vi.mocked(notesApi.createSession).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({sessionId:'new-session'});
  render(<MemoryRouter><NotesPanel initialId="note" onNavigate={()=>{}}/></MemoryRouter>);await screen.findByLabelText('笔记内容');
  fireEvent.click(screen.getByRole('button',{name:'用此笔记开启新会话'}));await screen.findByText('timeout');
  fireEvent.click(screen.getByRole('button',{name:'用此笔记开启新会话'}));await waitFor(()=>expect(notesApi.createSession).toHaveBeenCalledTimes(2));
  expect(vi.mocked(notesApi.createSession).mock.calls[0]).toEqual(vi.mocked(notesApi.createSession).mock.calls[1]);
});

it.each(['native','page'])('keeps selection and the note editor inside the %s fullscreen surface',async mode=>{
  const surface=document.createElement('div');document.body.append(surface);
  if(mode==='native')Object.defineProperty(document,'fullscreenElement',{configurable:true,value:surface});
  else surface.dataset.chatReadingMode='true';
  const view=render(<Selectable/>,{container:surface});
  try {
    act(()=>select(surface.querySelector('[data-note-message="answer"]')!));
    expect(surface.querySelector('[data-note-toolbar]')).toBeTruthy();
    fireEvent.keyDown(document,{key:'Escape'});expect(surface.querySelector('[data-note-toolbar]')).toBeNull();
    view.rerender(<MemoryRouter><NotesDialog noteId="note" onClose={()=>{}}/></MemoryRouter>);
    await screen.findByLabelText('笔记内容');expect(surface.querySelector('[data-notes-dialog]')).toBeTruthy();
  } finally {view.unmount();surface.remove();if(mode==='native')delete (document as unknown as Record<string,unknown>).fullscreenElement;}
});
