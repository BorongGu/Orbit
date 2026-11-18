import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { CodexBtwConnection } from '@/modules/providers/list/codex/codex-btw-connection.js';
import { OpenCodeBtwConnection } from '@/modules/providers/list/opencode/opencode-btw-connection.js';

function running(pid: number): boolean {
  try {
    if (process.platform === 'linux') return !readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z');
    process.kill(pid, 0);return true;
  } catch { return false; }
}

test('Codex BTW uses the managed daemon executable before PATH and honors the explicit override', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'orbit-btw-binary-test-'));
  const managed = path.join(directory, 'packages', 'app-server-daemon', 'current', 'bin', 'codex');
  const pathBinary = path.join(directory, 'codex');
  const override = path.join(directory, 'override');
  const previous = { CODEX_HOME: process.env.CODEX_HOME, CODEX_BTW_BIN: process.env.CODEX_BTW_BIN, PATH: process.env.PATH };
  await mkdir(path.dirname(managed), { recursive: true });
  try {
    for (const [binary, label] of [[managed, 'managed'], [pathBinary, 'path'], [override, 'override']]) {
      await writeFile(binary, `#!${process.execPath}
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const { id } = JSON.parse(line);
  if (id !== undefined) console.log(JSON.stringify({ id, result: ${JSON.stringify(label)} }));
});
`, { mode: 0o700 });
    }
    process.env.CODEX_HOME = directory;
    process.env.PATH = `${directory}${path.delimiter}${previous.PATH || ''}`;
    delete process.env.CODEX_BTW_BIN;

    async function probe(expected: string) {
      const client = new CodexBtwConnection();
      try {
        await client.initialize();
        assert.equal(await client.call('model/list', {}), expected);
      } finally { await client.close(); }
    }

    await probe('managed');
    process.env.CODEX_BTW_BIN = override;
    await probe('override');
    delete process.env.CODEX_BTW_BIN;
    await chmod(managed, 0o600);
    await probe('path');
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

for (const provider of ['codex', 'opencode'] as const) test(`${provider} close reaps a tool that outlives its direct parent`, { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'orbit-btw-cleanup-test-'));
  const binary = path.join(directory, 'native.mjs');const metadata = path.join(directory, 'owned.json');
  const previousDb = process.env.OPENCODE_DB;
  process.env.OPENCODE_DB = path.join(directory, 'source.db');
  await writeFile(binary, `#!${process.execPath}
import fs from 'node:fs';import http from 'node:http';import readline from 'node:readline';import {spawn} from 'node:child_process';
const command=process.argv[2];
if(command==='--version'){console.log('1.18.32');process.exit(0);}
if(command==='export'){console.log(JSON.stringify({info:{id:'source'},messages:[]}));process.exit(0);}
if(command==='import')process.exit(0);
const leaf=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
leaf.once('message',()=>{
  fs.writeFileSync(${JSON.stringify(metadata)},JSON.stringify({parent:process.pid,leaf:leaf.pid,data:process.env.XDG_DATA_HOME}));
  if(command==='app-server')readline.createInterface({input:process.stdin}).on('line',line=>{const message=JSON.parse(line);if(message.id)console.log(JSON.stringify({id:message.id,result:{}}));});
  else {const server=http.createServer((req,res)=>{if(req.url.startsWith('/event')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {}\\n\\n');}else res.end(JSON.stringify({id:'private-fork'}));});server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));}
});
`);
  await chmod(binary, 0o700);
  const client = provider === 'codex' ? new CodexBtwConnection(binary) : new OpenCodeBtwConnection('source', directory, binary);
  let owned: { parent: number; leaf: number; data?: string } | undefined;
  try {
    await client.initialize();owned = JSON.parse(await readFile(metadata, 'utf8'));
    assert.ok(running(owned!.leaf));
    const closing = client.close();assert.equal(client.close(), closing);
    await closing;
    for (let n = 0; n < 100 && running(owned!.leaf); n++) await delay(10);
    assert.equal(running(owned!.parent), false);assert.equal(running(owned!.leaf), false);
    if (provider === 'opencode') assert.equal(existsSync(path.dirname(owned!.data!)), false);
  } finally {
    await client.close();
    if (owned) { try { process.kill(-owned.parent, 'SIGKILL'); } catch { /* Reaped by the adapter. */ } }
    if (previousDb === undefined) delete process.env.OPENCODE_DB;else process.env.OPENCODE_DB = previousDb;
    await rm(directory, { recursive: true, force: true });
  }
});
