import Taro from '@tarojs/taro';
import { getSession, getSessionGeneration } from './session';
import type { MessageInput } from '@/types/models';

export interface PendingChatMessage { body: MessageInput; createdAt: number }
interface Outbox { version: number; owner: string; conversation: string; entries: PendingChatMessage[] }
export interface ChatOutboxRepair {
  snapshot: string;
  entries: PendingChatMessage[];
  skipped: number;
}
export class ChatOutboxFormatError extends Error {
  constructor() { super('待发送记录格式异常，未覆盖原记录'); }
}
const key = (owner: string, conversation: string) =>
  `aiye.chatOutbox.v1.${encodeURIComponent(owner)}.${encodeURIComponent(conversation)}`;
const current = (owner: string, generation: number) => {
  const session = getSession();
  if (!owner || !session.token || session.user?.id !== owner || getSessionGeneration() !== generation) {
    throw new Error('登录状态已变化，未更新待发送记录');
  }
};
const validBody = (body: unknown): body is MessageInput => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
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
const validEntry = (entry: unknown): entry is PendingChatMessage => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const value = entry as PendingChatMessage;
  return validBody(value.body) && Number.isFinite(value.createdAt) && value.createdAt >= 0;
};

export const readChatOutbox = (owner: string, conversation: string, generation: number): PendingChatMessage[] => {
  current(owner, generation);
  const stored: unknown = Taro.getStorageSync(key(owner, conversation));
  if (stored === undefined || stored === null || stored === '') return [];
  if (!stored || typeof stored !== 'object') throw new ChatOutboxFormatError();
  const box = stored as Outbox;
  if (box.version !== 1 || box.owner !== owner || box.conversation !== conversation || !Array.isArray(box.entries)
    || box.entries.length > 100 || !box.entries.every(validEntry)
    || new Set(box.entries.map(entry => entry.body.client_message_id)).size !== box.entries.length) {
    throw new ChatOutboxFormatError();
  }
  return JSON.parse(JSON.stringify(box.entries)) as PendingChatMessage[];
};
const serializedBox = (owner: string, conversation: string, entries: PendingChatMessage[]) => {
  const box: Outbox = { version: 1, owner, conversation, entries };
  const serialized = JSON.stringify(box);
  if (entries.length > 100 || serialized.length > 150000) throw new Error('待发送记录空间不足，请先处理已有记录');
  return serialized;
};
const save = (owner: string, conversation: string, generation: number, entries: PendingChatMessage[]) => {
  current(owner, generation);
  // Keep a record below the platform's per-key limit; never silently discard unsent messages.
  const serialized = serializedBox(owner, conversation, entries);
  if (entries.length) Taro.setStorageSync(key(owner, conversation), JSON.parse(serialized));
  else Taro.removeStorageSync(key(owner, conversation));
};
export const inspectChatOutboxRepair = (owner: string, conversation: string, generation: number): ChatOutboxRepair => {
  current(owner, generation);
  const stored: unknown = Taro.getStorageSync(key(owner, conversation));
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('无法识别记录结构，未修改原记录');
  }
  const box = stored as Outbox;
  // Unknown versions and foreign envelopes require migration, not a guessed repair.
  if (box.version !== 1 || box.owner !== owner || box.conversation !== conversation || !Array.isArray(box.entries)) {
    throw new Error('记录版本或归属不匹配，未修改原记录');
  }
  const counts = new Map<string, number>();
  for (const entry of box.entries) {
    const id = entry && typeof entry === 'object' && entry.body?.client_message_id;
    if (typeof id === 'string') counts.set(id, (counts.get(id) || 0) + 1);
  }
  // A duplicate ID may represent conflicting intents. Do not choose one to send.
  const entries = box.entries.filter(entry => validEntry(entry) && counts.get(entry.body.client_message_id || '') === 1);
  serializedBox(owner, conversation, entries);
  return { snapshot: JSON.stringify(stored), entries: JSON.parse(JSON.stringify(entries)), skipped: box.entries.length - entries.length };
};
export const repairChatOutbox = (owner: string, conversation: string, generation: number, preview: ChatOutboxRepair) => {
  const inspected = inspectChatOutboxRepair(owner, conversation, generation);
  if (inspected.snapshot !== preview.snapshot) throw new Error('待发送记录已变化，请重新检查后确认');
  if (!inspected.skipped) throw new Error('没有可修复的损坏条目，未修改原记录');
  const backupKey = `${key(owner, conversation)}.recovery`;
  const existing: unknown = Taro.getStorageSync(backupKey);
  const backup = { version: 1, owner, conversation, original: JSON.parse(inspected.snapshot) };
  const serializedBackup = JSON.stringify(backup);
  if (existing !== undefined && existing !== null && existing !== '' && JSON.stringify(existing) !== serializedBackup) {
    throw new Error('已有另一份修复备份，未覆盖备份或原记录');
  }
  current(owner, generation);
  Taro.setStorageSync(backupKey, backup);
  if (JSON.stringify(Taro.getStorageSync(backupKey)) !== serializedBackup) throw new Error('原记录备份未验证，未执行修复');
  current(owner, generation);
  if (JSON.stringify(Taro.getStorageSync(key(owner, conversation))) !== inspected.snapshot) {
    throw new Error('待发送记录已变化，保留备份但未执行修复');
  }
  save(owner, conversation, generation, inspected.entries);
  current(owner, generation);
  const repaired: unknown = Taro.getStorageSync(key(owner, conversation));
  const verified = inspected.entries.length
    ? JSON.stringify(repaired) === serializedBox(owner, conversation, inspected.entries)
    : repaired === undefined || repaired === null || repaired === '';
  if (!verified) throw new Error('修复结果未验证，原始备份已保留');
  return { recovered: inspected.entries.length, skipped: inspected.skipped };
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
