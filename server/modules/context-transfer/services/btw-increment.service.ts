import { createHash, randomUUID } from 'node:crypto';

import { contextTransferDb } from '@/modules/database/index.js';
import { btwRegistry } from '@/modules/websocket/index.js';
import { contextSnapshotService } from '@/modules/context-transfer/services/context-snapshot.service.js';
import { contextPackageService } from '@/modules/context-transfer/services/context-package.service.js';
import { contextDeliveryService } from '@/modules/context-transfer/services/context-delivery.service.js';
import { AppError } from '@/shared/index.js';
import type { ContextBriefing, ContextDelivery, ContextRecord, ContextSnapshot, LLMProvider } from '@/shared/types.js';

const MAX_EVIDENCE_CHARS = 12_000;
const BRIEFING_CHARS = 3_300;
const PACKAGE_CHARS = 6_000;

function excerpt(value: string, length: number): string {
  const text = value.trim();
  if (text.length <= length) return text;
  const head = Math.floor((length - 52) * .65);
  return `${text.slice(0, head)}\n[… middle omitted; see cited source record …]\n${text.slice(-(length - head - 52))}`;
}

function brief(records: ContextRecord[]): ContextBriefing {
  const turns = new Map<number, ContextRecord[]>();
  for (const record of records) turns.set(record.turn, [...(turns.get(record.turn) || []), record]);
  const selected = [...turns].slice(-6);
  const allowance = Math.max(200, Math.floor(BRIEFING_CHARS / selected.length) - 35);
  return { author: 'Orbit BTW incremental transfer',
    topics: [{ title: 'BTW developments after the native fork',
      summary: `Extractive briefing of the newest ${selected.length} BTW turns. All ${turns.size} post-fork turns remain in the cited source records.`,
      turns: [...turns.keys()] }],
    items: selected.map(([turn, entries]) => {
      const user = entries.find(record => record.role === 'user');
      const answers = entries.filter(record => record.role === 'assistant');
      const answer = answers.map(record => record.content).join('\n');
      const question = excerpt(user?.content || 'Follow-up to the previous BTW question', Math.min(130, Math.floor(allowance / 3)));
      const response = excerpt(answer || 'The BTW answer is pending.', allowance - question.length - 36);
      return { kind: 'progress' as const, status: 'reported' as const,
        text: `BTW turn ${turn}. Question: ${question}\nAnswer excerpt: ${response}`,
        refs: [...new Set([user?.ref, ...answers.map(record => record.ref)].filter((ref): ref is string => Boolean(ref)))].slice(0, 20) };
    }) };
}

/** Context REST uses this service to attach only the source window's new, bounded evidence to its parent. */
export function createBtwIncrementService(overrides: Partial<{
  delta: typeof btwRegistry.delta;
  mark: typeof btwRegistry.markShared;
  source: typeof contextSnapshotService.source;
  save: typeof contextTransferDb.saveSnapshot;
  byRequest: typeof contextTransferDb.byRequest;
  create: typeof contextPackageService.create;
  deliver: typeof contextDeliveryService.deliver;
  readDelivery: typeof contextDeliveryService.read;
}> = {}) {
  const dependencies = {
  delta: btwRegistry.delta.bind(btwRegistry),
  mark: btwRegistry.markShared.bind(btwRegistry),
  source: contextSnapshotService.source.bind(contextSnapshotService),
  save: contextTransferDb.saveSnapshot.bind(contextTransferDb),
  byRequest: contextTransferDb.byRequest.bind(contextTransferDb),
  create: contextPackageService.create.bind(contextPackageService),
  deliver: contextDeliveryService.deliver.bind(contextDeliveryService),
  readDelivery: contextDeliveryService.read.bind(contextDeliveryService),
    ...overrides,
  };
  const inFlight = new Map<string, Promise<ContextDelivery>>();
  const run = async (userId: number, conversationId: string): Promise<ContextDelivery> => {
    const owner = String(userId);
    let delta;
    try { delta = dependencies.delta(owner, conversationId); }
    catch (error) {
      if (error instanceof Error && /expired/i.test(error.message)) {
        throw new AppError('This BTW conversation has expired.', { code: 'BTW_EXPIRED', statusCode: 404 });
      }
      throw error;
    }
    if (delta.closed) throw new AppError('This BTW conversation has ended.', { code: 'BTW_CLOSED', statusCode: 409 });
    if (delta.busy) throw new AppError('Wait for the BTW reply to finish.', { code: 'BTW_BUSY', statusCode: 409 });
    if (!delta.messages.length && delta.lastDeliveryId) return dependencies.readDelivery(userId, delta.lastDeliveryId);
    const messages = delta.messages.filter(message => message.content.trim());
    if (!delta.lastMessageId || messages.at(-1)?.role !== 'assistant') {
      throw new AppError('Ask a BTW question and wait for its answer first.', { code: 'BTW_EMPTY', statusCode: 409 });
    }
    const source = dependencies.source(userId, delta.sourceSessionId);
    const requestId = `btw:${createHash('sha256').update(JSON.stringify([conversationId, delta.lastMessageId])).digest('hex')}`;
    const previous = dependencies.byRequest(userId, requestId);
    if (previous) {
      dependencies.mark(owner, conversationId, delta.lastMessageId, previous.id);
      return previous;
    }
    let turn = 0;
    const records: ContextRecord[] = messages.map((message, index) => {
      if (message.role === 'user') turn++;
      turn = Math.max(1, turn);
      return { ref: `btw-${index + 1}`, turn, messageId: message.id, timestamp: new Date().toISOString(),
        kind: 'message', role: message.role, content: excerpt(message.content, MAX_EVIDENCE_CHARS) };
    });
    const serialized = JSON.stringify(records);
    if (Buffer.byteLength(serialized) > 32 * 1024 * 1024) {
      throw new AppError('The BTW increment exceeds the capture limit.', { code: 'BTW_TOO_LARGE', statusCode: 413 });
    }
    const snapshot: ContextSnapshot = { id: randomUUID(), sourceSessionId: delta.sourceSessionId,
      provider: source.provider as LLMProvider, projectPath: source.project_path,
      title: 'BTW incremental context', createdAt: new Date().toISOString(),
      fingerprint: createHash('sha256').update(serialized).digest('hex'), sourceWasRunning: false, records,
      limitations: ['Only BTW messages created after the native fork are included; inherited parent context is excluded.',
        'Long source messages are excerpted at 12,000 characters. The inline briefing emphasizes the six newest turns.'] };
    dependencies.save(userId, snapshot);
    const value = await dependencies.create(userId, { snapshotId: snapshot.id, scope: { kind: 'all_topics' },
      granularity: 'coarse', briefing: brief(records), maxChars: PACKAGE_CHARS });
    const delivery = await dependencies.deliver(userId, value.id, { targetSessionId: delta.sourceSessionId, requestId,
      mode: 'attach', instruction: 'Use these incremental BTW findings as attributed context on the next parent turn. Earlier parent history is already present in this session.' });
    dependencies.mark(owner, conversationId, delta.lastMessageId, delivery.id);
    return delivery;
  };
  return {
    share(userId: number, conversationId: string): Promise<ContextDelivery> {
      const key = JSON.stringify([userId, conversationId]);
      const pending = inFlight.get(key);
      if (pending) return pending;
      const operation = run(userId, conversationId).finally(() => { inFlight.delete(key); });
      inFlight.set(key, operation);
      return operation;
    },
  };
}

/** The BTW context route shares this instance so simultaneous clicks use one durable receipt. */
export const btwIncrementService = createBtwIncrementService();
