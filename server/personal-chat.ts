import { readFile } from 'node:fs/promises';

import { createPersonalChatService, createPersonalServer } from '@/modules/personal-chat/index.js';

const credentials = JSON.parse(await readFile(process.env.PERSONAL_CHAT_CREDENTIALS || '/run/personal-chat-credentials.json', 'utf8'));
if (!credentials.username || !/^[a-f0-9]{64}$/.test(credentials.passwordHash) || credentials.sessionSecret?.length < 40) throw new Error('Personal credentials are incomplete.');
const service = await createPersonalChatService('/data/chat');
void service.warm().catch(() => console.log('Personal model will reconnect on the next request.'));
const server = createPersonalServer(service, credentials, '/app/public');
server.listen(3002, '0.0.0.0', () => console.log('Personal chat ready on port 3002'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close();void service.close().finally(() => process.exit(0));
});
