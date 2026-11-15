import { request } from './api';
export interface Inquiry {
  id: string; title: string; kind: 'service' | 'experience'; user_id: string; host_id: string;
  conversation_id: string; status: 'pending' | 'replied' | 'closed'; version: number;
  details: Record<string, unknown>;
}
export interface Notice { id: string; title: string; conversation_id: string; is_read: boolean }
export interface LoginSession { id: string; created_at: number; expires_at: number; is_current: boolean }
export interface Block { peer_id: string }
export interface Feedback { id: string; category: string; status: string; admin_note: string }
export const getFeedbacks = (skip = 0) => request<Feedback[]>(`/me/feedbacks?skip=${skip}&limit=100`);
export interface Reminders { enabled: boolean; remote_push_enabled: boolean }
export interface SearchItem { id: string; kind: 'service' | 'experience'; title: string; location: string; host_id: string }
export const getInquiries = (skip = 0) => request<Inquiry[]>(`/me/inquiries?skip=${skip}&limit=100`);
export const getNotices = (skip = 0) => request<Notice[]>(`/me/notices?skip=${skip}&limit=100`);
export const getSessions = () => request<LoginSession[]>('/auth/sessions');
export const getBlocks = () => request<Block[]>('/me/blocks');
export const getReminders = () => request<Reminders>('/me/reminders');
export const mutation = <T = { success?: boolean; closed?: boolean }>(
  path: string, method: 'POST' | 'PUT' | 'DELETE' = 'POST', value?: object,
) => request<T>(path, method, value);
export const searchCatalog = (kind: string, q: string, city: string, category: string, skip = 0) =>
  request<SearchItem[]>(`/catalog/search?${Object.entries({ kind, q, city, category, skip: String(skip) })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`);
