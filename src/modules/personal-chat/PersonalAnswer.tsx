import { memo } from 'react';

import { Reasoning, ReasoningContent, ReasoningTrigger, StreamingMarkdown } from '@/modules/chat';
import type { PersonalChatMessage } from '@/shared/types';

/** PersonalChat loads CloudCLI's answer renderer after login so its initial screen stays small. */
export default memo(function PersonalAnswer({ message, busy }: { message: PersonalChatMessage; busy: boolean }) {
  return <>
    {message.reasoning && <Reasoning isStreaming={busy && !message.text} className="personal-reasoning">
      <ReasoningTrigger getThinkingMessage={streaming => streaming ? '思考中…' : '思考摘要'} />
      <ReasoningContent><StreamingMarkdown content={message.reasoning} isStreaming={busy && !message.text} restricted className="personal-prose" /></ReasoningContent>
    </Reasoning>}
    {message.text && <StreamingMarkdown content={message.text} isStreaming={busy} restricted className="personal-prose" />}
  </>;
} , (previous, next) => previous.busy === next.busy
  && previous.message.id === next.message.id
  && previous.message.text === next.message.text
  && previous.message.reasoning === next.message.reasoning);
