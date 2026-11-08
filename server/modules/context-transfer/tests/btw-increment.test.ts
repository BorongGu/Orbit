import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, contextTransferDb, initializeDatabase, sessionsDb, userDb } from '@/modules/database/index.js';
import { createBtwIncrementService } from '@/modules/context-transfer/services/btw-increment.service.js';
import { contextPackageService } from '@/modules/context-transfer/services/context-package.service.js';
import type { BtwDelta, BtwEvent } from '@/shared/types.js';

const message = (id: string, role: 'user' | 'assistant', content: string): Extract<BtwEvent, { kind: 'btw_message' }> =>
  ({ kind: 'btw_message', id, role, content });

async function fixture(run: (userId: number) => Promise<void>) {
  const previous = process.env.DATABASE_PATH;
  const folder = await mkdtemp(path.join(os.tmpdir(), 'orbit-btw-transfer-'));
  closeConnection();process.env.DATABASE_PATH = path.join(folder, 'auth.db');await initializeDatabase();
  const userId = Number(userDb.createUser('owner', 'hash').id);
  sessionsDb.createAppSession('parent', 'codex', folder, 'Parent');
  try { await run(userId); }
  finally { closeConnection();if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;await rm(folder, { recursive: true, force: true }); }
}

test('BTW sharing captures only post-fork evidence, compresses it and attaches it once to the parent', async () => {
  await fixture(async userId => {
    let lastDeliveryId: string | null = null;
    let sharedThrough: string | null = null;
    let marks = 0;
    const all = [message('q1', 'user', 'What changed?'), message('a1', 'assistant', 'The first BTW-only finding.'),
      message('q2', 'user', 'What is next?'), message('a2', 'assistant', 'Verify the new adapter and report the result.')];
    const service = createBtwIncrementService({
      delta: (owner, id): BtwDelta => {
        assert.equal(owner, String(userId));assert.equal(id, 'fork');
        const start = sharedThrough ? all.findIndex(entry => entry.id === sharedThrough) + 1 : 0;
        const messages = all.slice(start);
        return { sourceSessionId: 'parent', messages, lastMessageId: messages.at(-1)?.id ?? null,
          lastDeliveryId, busy: false, closed: false };
      },
      mark: (_owner, _id, messageId, deliveryId) => { sharedThrough = messageId;lastDeliveryId = deliveryId;marks++; },
    });
    const [first, sameClick] = await Promise.all([service.share(userId, 'fork'), service.share(userId, 'fork')]);
    assert.equal(first.id, sameClick.id);assert.equal(first.status, 'pending');assert.equal(first.targetSessionId, 'parent');
    assert.equal(marks, 1);assert.equal(sharedThrough, 'a2');
    const pkg = contextPackageService.read(userId, first.packageId);
    assert.equal(pkg.sourceSessionId, 'parent');assert.ok(pkg.text.includes('Verify the new adapter'));
    assert.ok(pkg.text.length <= 6000);assert.ok(!pkg.text.includes('Inherited private parent turn'));
    assert.deepEqual(contextPackageService.records(userId, pkg.id).map(entry => entry.messageId), ['q1', 'a1', 'q2', 'a2']);
    assert.equal((await service.share(userId, 'fork')).id, first.id);assert.equal(marks, 1);
    const claimed = contextTransferDb.claim('parent');assert.equal(claimed.length, 1);
    assert.ok(claimed[0].prompt.includes('BTW developments after the native fork'));
    all.push(message('q3', 'user', 'Any tests?'), message('a3', 'assistant', 'All focused checks passed.'));
    const next = await service.share(userId, 'fork');assert.notEqual(next.id, first.id);
    assert.deepEqual(contextPackageService.records(userId, next.packageId).map(entry => entry.messageId), ['q3', 'a3']);
  });
});

test('BTW sharing waits for a completed reply and keeps an expired fork outside the delivery queue', async () => {
  await fixture(async userId => {
    const idle = { sourceSessionId: 'parent', messages: [message('q', 'user', 'Still thinking?')],
      lastMessageId: 'q', lastDeliveryId: null, busy: false, closed: false };
    const service = createBtwIncrementService({ delta: () => ({ ...idle, busy: true }) });
    await assert.rejects(service.share(userId, 'fork'), (error: any) => error.code === 'BTW_BUSY');
    const waiting = createBtwIncrementService({ delta: () => idle });
    await assert.rejects(waiting.share(userId, 'fork'), (error: any) => error.code === 'BTW_EMPTY');
    const expired = createBtwIncrementService({ delta: () => { throw Error('expired'); } });
    await assert.rejects(expired.share(userId, 'fork'), (error: any) => error.code === 'BTW_EXPIRED');
    assert.deepEqual(contextTransferDb.claim('parent'), []);
  });
});

test('long BTW discussions remain bounded while all post-fork turns stay available as evidence', async () => {
  await fixture(async userId => {
    const messages = Array.from({ length: 9 }, (_, index) => [
      message(`q${index}`, 'user', `Question ${index}: compare the implementation and checks.`),
      message(`a${index}`, 'assistant', `Answer ${index}: ${'A detailed finding. '.repeat(900)}`),
    ]).flat();
    const service = createBtwIncrementService({
      delta: () => ({ sourceSessionId: 'parent', messages, lastMessageId: 'a8', lastDeliveryId: null, busy: false, closed: false }),
      mark: () => {},
    });
    const delivery = await service.share(userId, 'long-fork');
    const pkg = contextPackageService.read(userId, delivery.packageId);
    assert.ok(pkg.text.length <= 6000);
    assert.match(pkg.text, /Question 8/);
    assert.equal(contextPackageService.records(userId, pkg.id).length, 18);
    assert.ok(pkg.text.includes('All 9 post-fork turns remain in the cited source records'));
  });
});

test('retry after a receipt is saved reuses its delivery and advances the BTW boundary', async () => {
  await fixture(async userId => {
    let marks = 0;
    let sharedThrough: string | null = null;
    const service = createBtwIncrementService({
      delta: () => ({ sourceSessionId: 'parent', messages: sharedThrough ? [] : [
        message('q', 'user', 'What was checked?'), message('a', 'assistant', 'The adapter passed.')],
        lastMessageId: sharedThrough ? null : 'a', lastDeliveryId: null, busy: false, closed: false }),
      mark: (_owner, _id, messageId) => { marks++;
        if (marks === 1) throw new Error('Lost connection while updating the cursor');
        sharedThrough = messageId; },
    });
    await assert.rejects(service.share(userId, 'retry-fork'), /Lost connection/);
    const delivery = await service.share(userId, 'retry-fork');
    assert.equal(delivery.status, 'pending');
    assert.equal(sharedThrough, 'a');
    assert.equal(marks, 2);
    assert.equal(contextTransferDb.claim('parent').length, 1);
  });
});
