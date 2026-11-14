import Taro from '@tarojs/taro';
import { getSession } from './session';
import { hostOf, uniqueId } from '@/utils/catalog';
import type { ActivityRecord, CalendarClosure, Experience, ItemKind, Service } from '@/types/models';

const key = (name: string) => `aiye.${name}.${getSession().user?.id || 'guest'}`;
export const getActivity = (name: 'viewed' | 'booked'): ActivityRecord[] =>
  Taro.getStorageSync<ActivityRecord[]>(key(name)) || [];
export const recordView = (item: Service | Experience, kind: ItemKind) => {
  const host = hostOf(item, kind);
  const record: ActivityRecord = {
    id: `${kind}:${item.id}`, item_id: item.id, kind, title: item.title,
    cover_image_url: item.cover_image_url, location: item.location,
    price_text: item.price_text, category: item.category,
    host_id: host.id, host_name: host.name, recorded_at: Date.now(),
  };
  Taro.setStorageSync(key('viewed'), [record, ...getActivity('viewed').filter(value => value.id !== record.id)].slice(0, 300));
};
export const recordBooking = (item: Service | Experience, kind: ItemKind, scheduledAt: number, conversationId: string, messageId?: string) => {
  const id = messageId ? `inquiry:${messageId}` : uniqueId();
  const existing = getActivity('booked');
  if (existing.some(record => record.id === id)) return;
  const host = hostOf(item, kind);
  const record: ActivityRecord = {
    id, item_id: item.id, kind, title: item.title,
    cover_image_url: item.cover_image_url, location: item.location,
    price_text: item.price_text, category: item.category,
    host_id: host.id, host_name: host.name, recorded_at: Date.now(),
    scheduled_at: scheduledAt, status: 'inquiry', conversation_id: conversationId,
  };
  Taro.setStorageSync(key('booked'), [record, ...existing].slice(0, 300));
};
export const cancelBooking = (id: string) => Taro.setStorageSync(key('booked'),
  getActivity('booked').map(record => record.id === id ? { ...record, status: 'cancelled' } : record));
export const clearActivity = (name: 'viewed' | 'booked') => Taro.removeStorageSync(key(name));
export const getClosures = (serviceId: string): Record<string, CalendarClosure> =>
  Taro.getStorageSync<Record<string, CalendarClosure>>(key(`calendar.${serviceId}`)) || {};
export const setClosures = (serviceId: string, closures: Record<string, CalendarClosure>) =>
  Taro.setStorageSync(key(`calendar.${serviceId}`), closures);
