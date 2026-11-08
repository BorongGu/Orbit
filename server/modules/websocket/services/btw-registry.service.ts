import { createBtwSession } from '@/modules/providers/index.js';
import type { BtwDelta, BtwEvent, BtwInput, BtwSession } from '@/shared/types.js';

type Conversation = {
  session: BtwSession;
  sourceId: string;
  listeners: Set<(event: BtwEvent) => void>;
  messages: Map<string, Extract<BtwEvent, { kind: 'btw_message' }>>;
  ready?: Extract<BtwEvent, { kind: 'btw_ready' }>;
  status: Extract<BtwEvent, { kind: 'btw_status' }>;
  error?: Extract<BtwEvent, { kind: 'btw_error' }>;
  closed: boolean;
  closing?: Promise<void>;
  sharedThroughId?: string;
  lastDeliveryId?: string;
  timer?: ReturnType<typeof setTimeout>;
};

/** The BTW socket handler uses this registry to reconnect a user's window to its existing native fork. */
export function createBtwRegistry(createSession = createBtwSession, retentionMs = 30 * 60_000) {
  const conversations = new Map<string, Conversation>();
  const pendingCloses = new Set<Promise<void>>();
  let draining = false;
  let shutdown: Promise<void> | null = null;
  const key = (owner: string, id: string) => JSON.stringify([owner, id]);
  const find = (owner: string, id: string) => {
    const entry = conversations.get(key(owner, id));
    if (!entry) throw new Error('This temporary conversation has expired. Open a new /btw window.');
    return entry;
  };
  const publish = (entry: Conversation, event: BtwEvent) => {
    if (entry.closing && event.kind !== 'btw_closed') return;
    if (event.kind === 'btw_ready') entry.ready = event;
    if (event.kind === 'btw_message') { entry.messages.set(event.id, event);entry.error = undefined; }
    if (event.kind === 'btw_error') entry.error = event;
    if (event.kind === 'btw_status') {
      event = { ...event, busySince: event.busy && !entry.status.busy ? Date.now() : entry.status.busySince };
      entry.status = event;
    }
    if (event.kind === 'btw_closed') {
      if (entry.closed) return;
      entry.closed = true;
    }
    for (const listener of entry.listeners) listener(event);
  };
  const closeEntry = (entry: Conversation): Promise<void> => {
    if (entry.closing) return entry.closing;
    clearTimeout(entry.timer);
    entry.closing = Promise.resolve().then(() => entry.session.close()).finally(() => {
      try { publish(entry, { kind: 'btw_closed' }); }
      finally { entry.listeners.clear();entry.messages.clear();pendingCloses.delete(entry.closing!); }
    });
    pendingCloses.add(entry.closing);
    return entry.closing;
  };
  const finish = async (owner: string, id: string) => {
    const entry = conversations.get(key(owner, id));
    if (!entry) return;
    conversations.delete(key(owner, id));
    await closeEntry(entry);
  };
  return {
    attach(owner: string, id: string, emit: (event: BtwEvent) => void, input?: BtwInput) {
      if (draining) throw new Error('Orbit is restarting. Reconnect after the service is ready.');
      let entry = conversations.get(key(owner, id));
      if (entry && input && entry.sourceId !== input.sessionId) throw new Error('This BTW window belongs to another source conversation.');
      if (!entry) {
        if (!input) find(owner, id);
        const fresh: Conversation = { session: null as unknown as BtwSession, sourceId: input!.sessionId,
          listeners: new Set(), messages: new Map(), closed: false,
          status: { kind: 'btw_status', busy: true, busySince: Date.now() } };
        fresh.session = createSession(input!, event => publish(fresh, event));
        entry = fresh;
        conversations.set(key(owner, id), entry);
        // Register first so a refresh racing native startup attaches to this same fork.
        void Promise.resolve().then(() => { if (!fresh.closed && !fresh.closing) return fresh.session.start(); }).catch(error => {
          publish(fresh, { kind: 'btw_error', message: error instanceof Error ? error.message : String(error) });
          void closeEntry(fresh).catch(() => {});
        });
      }
      const current = entry;
      clearTimeout(current.timer);
      current.listeners.add(emit);
      emit({ kind: 'btw_attached', conversationId: id });
      if (current.ready) emit(current.ready);
      for (const message of current.messages.values()) emit(message);
      emit(current.status);
      if (current.error) emit(current.error);
      if (current.closed) emit({ kind: 'btw_closed' });
      return () => {
        current.listeners.delete(emit);
        if (current.listeners.size || conversations.get(key(owner, id)) !== current) return;
        clearTimeout(current.timer);
        current.timer = setTimeout(() => { void finish(owner, id).catch(() => {}); }, retentionMs);
        current.timer.unref();
      };
    },
    async send(owner: string, id: string, content: string) { await find(owner, id).session.send(content); },
    async stop(owner: string, id: string) { await find(owner, id).session.stop(); },
    /** Context transfer reads only BTW-native messages newer than the last completed delivery. */
    delta(owner: string, id: string): BtwDelta {
      const entry = find(owner, id);
      const messages = [...entry.messages.values()];
      const boundary = entry.sharedThroughId ? messages.findIndex(message => message.id === entry.sharedThroughId) : -1;
      if (entry.sharedThroughId && boundary < 0) throw new Error('The BTW transfer boundary is unavailable.');
      const pending = messages.slice(boundary + 1);
      return { sourceSessionId: entry.sourceId, messages: pending, lastMessageId: pending.at(-1)?.id ?? null,
        lastDeliveryId: entry.lastDeliveryId ?? null, busy: entry.status.busy, closed: entry.closed };
    },
    /** A durable receipt advances the BTW boundary, including the last message captured by this click. */
    markShared(owner: string, id: string, messageId: string, deliveryId: string): void {
      const entry = find(owner, id);
      if (!entry.messages.has(messageId)) throw new Error('The BTW transfer boundary is unavailable.');
      entry.sharedThroughId = messageId;
      entry.lastDeliveryId = deliveryId;
    },
    finish,
    /** Server shutdown drains attached, detached and already-closing native runtimes before exit. */
    shutdown(): Promise<void> {
      if (shutdown) return shutdown;
      draining = true;
      for (const entry of conversations.values()) void closeEntry(entry);
      conversations.clear();
      shutdown = Promise.allSettled([...pendingCloses]).then(results => {
        const errors = results.filter(result => result.status === 'rejected');
        if (errors.length) throw new AggregateError(errors.map(result => result.reason), 'BTW shutdown cleanup failed.');
      });
      return shutdown;
    },
  };
}

/** Shared by all authenticated BTW sockets so a refreshed tab can resume its previous connection. */
export const btwRegistry = createBtwRegistry();
