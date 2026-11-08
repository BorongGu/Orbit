import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import type { NextFunction,Request,Response } from 'express';

import { closeConnection,getConnection,initializeDatabase,notesDb,sessionsDb,userDb } from '@/modules/database/index.js';
import { createProviderRuntimeService } from '@/modules/providers/index.js';
import { notesRoutes } from '@/modules/notes/notes.routes.js';
import { notesService } from '@/modules/notes/notes.service.js';
import { AppError } from '@/shared/index.js';
import type { IProvider,LLMProvider,OutputNote,ProviderRuntimeWriter } from '@/shared/index.js';

async function fixture(run:(state:{userId:number;otherId:number;folder:string;base:string})=>Promise<void>){
  const previous=process.env.DATABASE_PATH;const folder=await mkdtemp(path.join(os.tmpdir(),'orbit-notes-'));
  closeConnection();process.env.DATABASE_PATH=path.join(folder,'auth.db');await writeFile(process.env.DATABASE_PATH,'');await initializeDatabase();
  const userId=Number(userDb.createUser('owner','hash').id),otherId=Number(userDb.createUser('other','hash').id);
  sessionsDb.createAppSession('source','codex',folder,'Original research');sessionsDb.setSessionModel('source','frontier-model');
  const app=express().use(express.json()).use('/api/notes',(req:Request & {user?:{id:number}},_res,next)=>{req.user={id:Number(req.headers['x-user']||userId)};next();},notesRoutes);
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>res.status(error instanceof AppError?error.statusCode:500).json({error:error instanceof Error?error.message:String(error)}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{await run({userId,otherId,folder,base:`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/notes`});}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));closeConnection();if(previous===undefined)delete process.env.DATABASE_PATH;else process.env.DATABASE_PATH=previous;await rm(folder,{recursive:true,force:true});}
}
const selection={requestId:'quote-1',content:'A selected sentence.\n\nA second paragraph with $x^2$.',sourceSessionId:'source',sourceMessageId:'message-1',sourceAnchorId:'anchor-1'};

test('notes are owned, durable, idempotent and retain original provenance while edited',async()=>fixture(async({userId,otherId,base})=>{
  const post=()=>fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection)});
  const response=await post();assert.equal(response.status,201);const note=(await response.json() as {data:OutputNote}).data;
  assert.equal(note.excerpt,selection.content);assert.equal(note.sourceTitle,'Original research');assert.equal(note.sourceAnchorId,'anchor-1');
  assert.equal((await (await post()).json() as {data:OutputNote}).data.id,note.id);
  assert.equal((await fetch(base+'/'+note.id,{headers:{'x-user':String(otherId)}})).status,404);
  assert.deepEqual(notesDb.list(otherId,'',0).notes,[]);
  const edited=notesService.update(userId,note.id,'Short note','Edited synthesis',note.revision);
  assert.equal(edited.excerpt,selection.content);assert.equal(edited.revision,2);
  assert.throws(()=>notesService.update(userId,note.id,'Old editor','Overwrite',1),/其他页面更新/);
  getConnection().prepare('DELETE FROM sessions WHERE session_id=?').run('source');
  assert.equal(notesService.read(userId,note.id).content,'Edited synthesis');
  const reopened=notesDb.get(userId,note.id);assert.equal(reopened?.sourceSessionId,'source');
}));

test('search treats wildcard characters literally and paginates complete note history',async()=>fixture(async({userId})=>{
  for(let index=0;index<55;index++)notesService.create(userId,{...selection,requestId:`quote-${index}`,content:index===0?'100% reliable_ result':`Entry ${index}`});
  assert.equal(notesDb.list(userId,'%',0).notes.length,1);assert.equal(notesDb.list(userId,'_',0).notes.length,1);
  const first=notesDb.list(userId,'',0),second=notesDb.list(userId,'',first.nextOffset);
  assert.equal(first.notes.length,50);assert.equal(first.hasMore,true);assert.equal(second.notes.length,5);assert.equal(second.hasMore,false);
}));

test('BTW excerpts retain their side-conversation source and can seed a session after the source is removed',async()=>fixture(async({userId,base})=>{
  const input={...selection,sourceKind:'btw',sourceConversationId:'side-window',sourceModel:'btw-model'};
  const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal(response.status,201);const note=(await response.json() as {data:OutputNote}).data;
  assert.equal(note.sourceKind,'btw');assert.equal(note.sourceConversationId,'side-window');
  assert.equal(note.sourceSessionId,'source');assert.equal(note.sourceTitle,'Original research · BTW');
  getConnection().prepare('DELETE FROM sessions WHERE session_id=?').run('source');
  const {sessionId}=await notesService.createSession(userId,note.id,{requestId:'from-btw'});
  assert.equal(notesDb.context(userId,sessionId)?.note.content,selection.content);
  assert.equal(sessionsDb.getSessionById(sessionId)?.model,'btw-model');
  const malformed=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestId:'malformed',sourceConversationId:undefined})});
  assert.equal(malformed.status,400);
}));

for(const provider of ['claude','codex','opencode','cursor'] as const)test(`${provider} reads frozen note context exactly once when the first ordinary turn starts`,async()=>fixture(async({userId,otherId,folder})=>{
  const note=notesService.create(userId,selection);
  const options={requestId:'start-1',provider,model:'chosen-model',effort:'high',projectPath:folder};
  const {sessionId}=await notesService.createSession(userId,note.id,options);
  assert.equal((await notesService.createSession(userId,note.id,options)).sessionId,sessionId);
  assert.equal(sessionsDb.getSessionById(sessionId)?.provider_session_id,null,'creation makes no model call');
  assert.equal(sessionsDb.getSessionById(sessionId)?.model,'chosen-model');assert.equal(notesDb.context(otherId,sessionId),null);
  notesService.update(userId,note.id,'Changed','A newer note',1);notesDb.remove(userId,note.id);
  assert.equal(notesDb.context(userId,sessionId)?.note.content,selection.content);
  const commands:string[]=[];
  const runtime=createProviderRuntimeService({groupInstructions:()=>undefined,resolveProvider:()=>({id:provider,runtime:{async run(command:string,_options:unknown,writer:ProviderRuntimeWriter){commands.push(command);writer.send({kind:'complete',exitCode:0});}}}) as unknown as IProvider});
  await runtime.run(provider,'Use the note to propose an experiment.',{sessionId},{send(){}});
  await runtime.run(provider,'Continue.',{sessionId},{send(){}});
  assert.match(commands[0],/A selected sentence/);assert.match(commands[0],/Original research/);assert.match(commands[0],/Current user message/);
  assert.equal(commands[1],'Continue.');assert.equal(notesDb.context(userId,sessionId)?.status,'delivered');
}));

test('failed launches are atomic; ambiguous runtime outcomes stay observable and are not replayed',async()=>fixture(async({userId})=>{
  const note=notesService.create(userId,selection);
  await assert.rejects(notesService.createSession(userId,note.id,{requestId:'bad',projectPath:'/missing-orbit-project'}),/工作目录/);
  assert.equal(getConnection().prepare('SELECT COUNT(*) AS count FROM note_session_contexts').get() && notesDb.contextByRequest(userId,'bad'),null);
  const {sessionId}=await notesService.createSession(userId,note.id,{requestId:'start'});
  await assert.rejects(notesService.createSession(userId,note.id,{requestId:'start',provider:'claude'}),/requestId/);
  const runtime=createProviderRuntimeService({groupInstructions:()=>undefined,resolveProvider:()=>({id:'codex',runtime:{async run(){throw new Error('connection lost');}}}) as unknown as IProvider});
  await assert.rejects(runtime.run('codex','go',{sessionId},{send(){}}),/connection lost/);
  assert.equal(notesDb.context(userId,sessionId)?.status,'uncertain');assert.equal(notesDb.claimContext(sessionId).length,0);
  const second=await notesService.createSession(userId,note.id,{requestId:'restart'});notesDb.claimContext(second.sessionId);notesDb.recover();
  assert.equal(notesDb.context(userId,second.sessionId)?.status,'uncertain');
}));

test('route validation rejects empty selections and forged provider values',async()=>fixture(async({userId,base})=>{
  const bad=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selection,content:' '})});assert.equal(bad.status,400);
  const note=notesService.create(userId,selection);
  const response=await fetch(`${base}/${note.id}/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'bad',provider:['codex']})});assert.equal(response.status,400);
}));
