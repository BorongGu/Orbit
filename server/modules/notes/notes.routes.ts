import express from 'express';
import type { Request } from 'express';

import { notesService } from '@/modules/notes/notes.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/index.js';
import type { LLMProvider } from '@/shared/index.js';

function invalid(field: string): never { throw new AppError(`Invalid ${field}.`, { code: 'INVALID_NOTE_INPUT', statusCode: 400 }); }
function body(value: unknown): Record<string,unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('body'); return value as Record<string,unknown>; }
function text(value: unknown, field: string, max = 128): string { if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(field); return value.trim(); }
function optional(value: unknown, field: string, max = 200): string | undefined { return value === undefined ? undefined : text(value,field,max); }
function timestamp(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const result = text(value,field,32);const milliseconds = Date.parse(result);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== result) invalid(field);
  return result;
}
function search(req: Request): string { return req.query.q === undefined || typeof req.query.q === 'string' && !req.query.q.trim() ? '' : text(req.query.q,'q',500); }
function owner(req: Request): number { const id = Number((req as Request & { user?: { id?: number } }).user?.id); if (!Number.isSafeInteger(id) || id < 1) throw new AppError('Authenticated user required.',{code:'USER_REQUIRED',statusCode:401}); return id; }

/** Server mounts these user-owned note operations behind the existing authentication middleware. */
export const notesRoutes = express.Router();
notesRoutes.get('/',asyncHandler(async (req,res) => {
  const offset = Number(req.query.offset || 0); if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) invalid('offset');
  const from = timestamp(req.query.from,'from'), before = timestamp(req.query.before,'before');
  if (from && before && from >= before) invalid('date range');
  res.json(createApiSuccessResponse(notesService.list(owner(req),search(req),offset,{
    sourceSessionId:optional(req.query.sourceSessionId,'sourceSessionId',128),from,before,
  })));
}));
notesRoutes.get('/groups',asyncHandler(async (req,res) => {
  const by = req.query.by || 'session';if (by !== 'session' && by !== 'date') invalid('by');
  res.json(createApiSuccessResponse(notesService.groups(owner(req),search(req),by,optional(req.query.timeZone,'timeZone',100) || 'UTC')));
}));
notesRoutes.post('/',asyncHandler(async (req,res) => {
  const value = body(req.body);
  if (value.sourceKind !== undefined && value.sourceKind !== 'session' && value.sourceKind !== 'btw') invalid('sourceKind');
  if (value.sourceKind === 'btw') text(value.sourceConversationId,'sourceConversationId');
  res.status(201).json(createApiSuccessResponse(notesService.create(owner(req),{
    requestId:text(value.requestId,'requestId'),content:text(value.content,'content',32000),sourceSessionId:text(value.sourceSessionId,'sourceSessionId'),
    sourceMessageId:text(value.sourceMessageId,'sourceMessageId',512),sourceAnchorId:optional(value.sourceAnchorId,'sourceAnchorId',512),sourceModel:optional(value.sourceModel,'sourceModel'),
    sourceKind:value.sourceKind as 'session' | 'btw' | undefined,sourceConversationId:value.sourceKind === 'btw' ? text(value.sourceConversationId,'sourceConversationId') : undefined,
  })));
}));
notesRoutes.get('/session-context/:sessionId',asyncHandler(async (req,res) => res.json(createApiSuccessResponse(notesService.sessionContext(owner(req),text(req.params.sessionId,'sessionId'))))));
notesRoutes.get('/:id',asyncHandler(async (req,res) => res.json(createApiSuccessResponse(notesService.read(owner(req),text(req.params.id,'id'))))));
notesRoutes.patch('/:id',asyncHandler(async (req,res) => {
  const value = body(req.body); if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) invalid('revision');
  res.json(createApiSuccessResponse(notesService.update(owner(req),text(req.params.id,'id'),text(value.title,'title',200),text(value.content,'content',32000),Number(value.revision))));
}));
notesRoutes.delete('/:id',asyncHandler(async (req,res) => {
  notesService.remove(owner(req),text(req.params.id,'id')); res.json(createApiSuccessResponse({deleted:true}));
}));
notesRoutes.post('/:id/sessions',asyncHandler(async (req,res) => {
  const value = body(req.body);
  if (value.provider !== undefined && (typeof value.provider !== 'string' || !['claude','codex','opencode','cursor'].includes(value.provider))) invalid('provider');
  res.status(201).json(createApiSuccessResponse(await notesService.createSession(owner(req),text(req.params.id,'id'),{
    requestId:text(value.requestId,'requestId'),provider:value.provider as LLMProvider | undefined,model:optional(value.model,'model'),effort:optional(value.effort,'effort'),projectPath:optional(value.projectPath,'projectPath',4096),
  })));
}));
