import { getMessages } from './api';
import { compareChatMessages } from '@/utils/chat';
import type { ChatMessage } from '@/types/models';

export const readMessageGap = async (
  conversationId: string,
  anchor: ChatMessage | undefined,
  isCurrent: () => boolean,
  fromKnownEmpty = false,
) => {
  let page = await getMessages(conversationId);
  const latest = page[page.length - 1];
  const incoming = [...page];
  while (page.length === 100 && page[0]
    && (fromKnownEmpty || (anchor && compareChatMessages(page[0], anchor) > 0))) {
    if (!isCurrent()) throw new Error('会话状态已变化');
    const cursor = page[0];
    page = await getMessages(conversationId, cursor.created_at, cursor.id);
    if (page.length && compareChatMessages(page[0], cursor) >= 0) {
      throw new Error('历史分页未前进，请检查后端游标支持');
    }
    incoming.push(...page);
  }
  if (!isCurrent()) throw new Error('会话状态已变化');
  return { messages: incoming.sort(compareChatMessages), latest, hasMore: page.length === 100 };
};
