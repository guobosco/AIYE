import Taro from '@tarojs/taro';
import { getSession, getSessionGeneration } from './session';
import type { MessageInput } from '@/types/models';

export interface PendingChatMessage { body: MessageInput; createdAt: number }
interface Outbox { version: number; owner: string; conversation: string; entries: PendingChatMessage[] }
const key = (owner: string, conversation: string) =>
  `aiye.chatOutbox.v1.${encodeURIComponent(owner)}.${encodeURIComponent(conversation)}`;
const current = (owner: string, generation: number) => {
  const session = getSession();
  if (!owner || !session.token || session.user?.id !== owner || getSessionGeneration() !== generation) {
    throw new Error('登录状态已变化，未更新待发送记录');
  }
};
const validBody = (body: unknown): body is MessageInput => {
  if (!body || typeof body !== 'object') return false;
  const value = body as Record<string, unknown>;
  if (typeof value.type !== 'string' || !['text', 'image', 'location', 'service', 'experience', 'file', 'service_card'].includes(value.type)
    || typeof value.client_message_id !== 'string' || !value.client_message_id.trim() || value.client_message_id.length > 128) return false;
  for (const field of ['content', 'attachment_url', 'attachment_name', 'object_key']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false;
  }
  if (value.attachment_size !== undefined && (typeof value.attachment_size !== 'number'
    || !Number.isFinite(value.attachment_size) || value.attachment_size < 0)) return false;
  if (value.extra !== undefined && (!value.extra || typeof value.extra !== 'object' || Array.isArray(value.extra)
    || !Object.values(value.extra).every(item => typeof item === 'string'))) return false;
  return true;
};

export const readChatOutbox = (owner: string, conversation: string, generation: number): PendingChatMessage[] => {
  current(owner, generation);
  const stored: unknown = Taro.getStorageSync(key(owner, conversation));
  if (stored === undefined || stored === null || stored === '') return [];
  if (!stored || typeof stored !== 'object') throw new Error('待发送记录格式异常，未覆盖原记录');
  const box = stored as Outbox;
  if (box.version !== 1 || box.owner !== owner || box.conversation !== conversation || !Array.isArray(box.entries)
    || box.entries.length > 100 || box.entries.some(entry => !entry || !validBody(entry.body)
      || !Number.isFinite(entry.createdAt) || entry.createdAt < 0)
    || new Set(box.entries.map(entry => entry.body.client_message_id)).size !== box.entries.length) {
    throw new Error('待发送记录格式异常，未覆盖原记录');
  }
  return JSON.parse(JSON.stringify(box.entries)) as PendingChatMessage[];
};
const save = (owner: string, conversation: string, generation: number, entries: PendingChatMessage[]) => {
  current(owner, generation);
  const box: Outbox = { version: 1, owner, conversation, entries };
  // Keep a record below the platform's per-key limit; never silently discard unsent messages.
  if (entries.length > 100 || JSON.stringify(box).length > 150000) throw new Error('待发送记录空间不足，请先处理已有记录');
  if (entries.length) Taro.setStorageSync(key(owner, conversation), JSON.parse(JSON.stringify(box)));
  else Taro.removeStorageSync(key(owner, conversation));
};
export const queueChatMessage = (owner: string, conversation: string, generation: number, body: MessageInput) => {
  if (!validBody(body)) throw new Error('待发送消息格式异常');
  const entries = readChatOutbox(owner, conversation, generation);
  const existing = entries.find(entry => entry.body.client_message_id === body.client_message_id);
  if (existing) {
    if (JSON.stringify(existing.body) !== JSON.stringify(body)) throw new Error('消息ID已用于另一条待发送消息');
    return;
  }
  save(owner, conversation, generation, [...entries, { body, createdAt: Date.now() }]);
};
export const confirmChatMessages = (owner: string, conversation: string, generation: number, ids: Set<string>) => {
  const entries = readChatOutbox(owner, conversation, generation);
  const remaining = entries.filter(entry => !ids.has(entry.body.client_message_id || ''));
  if (remaining.length !== entries.length) save(owner, conversation, generation, remaining);
};
