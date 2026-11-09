import { readFile } from 'node:fs/promises';

import { createPersonalEgressServer } from '@/modules/personal-chat/index.js';

const pinned = JSON.parse(await readFile('/run/personal-chat-egress.json', 'utf8'));
createPersonalEgressServer(pinned).listen(3128, '0.0.0.0', () => console.log('Personal OpenAI egress ready'));
