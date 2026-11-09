import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionMessageSearchService } from '@/modules/providers/services/session-message-search.service.js';
import type { NormalizedMessage } from '@/shared/index.js';

const message = (index: number, content = `row ${index} Needle 中文`): NormalizedMessage => ({ id: `m-${index}`, sessionId: 'session', provider: 'codex', kind: 'text', role: index % 2 ? 'assistant' : 'user', timestamp: '2026-01-01T00:00:00Z', content });
function fixture(count = 100) {
  let reads = 0, clock = 0;
  const messages = Array.from({length: count}, (_, index) => message(index));
  const service = createSessionMessageSearchService(async () => {
    reads++;return { messages: [...messages], total: messages.length, limit: null, offset: 0, hasMore: false };
  }, () => clock);
  return { service, messages, reads: () => reads, advance: (ms: number) => { clock += ms; } };
}

test('search pages are bounded, case insensitive and reuse a shared load; exact indices disambiguate timestamps', async () => {
  const f = fixture();
  const [page, other] = await Promise.all([f.service.search(1, 'session', 'needle'), f.service.search(1, 'session', '中文')]);
  assert.equal(f.reads(), 1);assert.equal(page.snapshot, other.snapshot);assert.equal(page.total, 100);assert.equal(page.hits.length, 40);
  const next = await f.service.search(1, 'session', 'NEEDLE', 40, page.snapshot);
  assert.equal(next.hits[0].index, 40);
  const window = f.service.window(1, 'session', page.snapshot, 42);
  assert.equal(window.messages[42 - window.start].id, 'm-42');assert.equal(window.messages.length, 31);
});

test('a snapshot keeps its target through later appends, while refresh sees new dialogue and excludes tool and reasoning records', async () => {
  const f = fixture(2);
  f.messages.push({...message(2), kind: 'tool_result'}, {...message(3), isThinking: true});
  const old = await f.service.search(1, 'session', 'needle');assert.equal(old.total, 2);
  f.messages.push(message(4));f.advance(3001);
  const fresh = await f.service.search(1, 'session', 'needle');assert.equal(fresh.total, 3);assert.notEqual(fresh.snapshot, old.snapshot);
  assert.equal(f.service.window(1, 'session', old.snapshot, 1).total, 2);
});

test('snapshot ownership, expiry and index bounds are enforced', async () => {
  const f = fixture(2), page = await f.service.search(1, 'session', 'needle');
  assert.throws(() => f.service.window(2, 'session', page.snapshot, 0), /过期/);
  assert.throws(() => f.service.window(1, 'other', page.snapshot, 0), /过期/);
  assert.throws(() => f.service.window(1, 'session', page.snapshot, 99), /范围/);
  f.advance(600001);assert.throws(() => f.service.window(1, 'session', page.snapshot, 0), /过期/);
});

test('50,000 dialogue messages return only snippets and 31-row windows', async () => {
  const f = fixture(50_000), start = performance.now();
  const page = await f.service.search(1, 'session', 'needle');
  const warm = performance.now();await f.service.search(1, 'session', '中文', 0, page.snapshot);
  console.log(`Search 50k: first ${(warm-start).toFixed(1)}ms; warm ${(performance.now()-warm).toFixed(1)}ms; response ${Buffer.byteLength(JSON.stringify(page))} bytes`);
  assert.equal(page.total, 50_000);assert.equal(page.hits.length, 40);assert.ok(JSON.stringify(page).length < 16_000);
  assert.equal(f.service.window(1, 'session', page.snapshot, 25_000).messages.length, 31);
});
