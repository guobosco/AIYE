import Taro from '@tarojs/taro';
import { getSession, getSessionGeneration, logout, refreshSession, setSession, updateSessionUser } from '@/store/session';
import { normalizeServiceCategory, uniqueId } from '@/utils/catalog';
import type {
  CatalogItem, ChatMessage, ConversationItem, Experience, ItemKind,
  MessageInput, Service, UploadResult, User, WishlistProfile,
  AuthResponse, TokenResponse, CalendarClosure, CalendarResponse,
} from '@/types/models';

export const API_BASE = (process.env.TARO_APP_API_BASE_URL || '')
  .replace(/^['"](.*)['"]$/, '$1').replace(/\/+$/, '');
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const errorText = (data: unknown) => {
  if (typeof data === 'object' && data !== null && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return '填写内容不符合要求，请检查后重试';
  }
  return '请求失败，请稍后重试';
};
let refreshTask: { generation: number; promise: Promise<void> } | undefined;
const refreshAccess = () => {
  const generation = getSessionGeneration();
  if (refreshTask?.generation === generation) return refreshTask.promise;
  const session = getSession();
  const promise = (async () => {
    if (!session.refreshToken) throw new ApiError(401, '请重新登录');
    const response = await Taro.request<TokenResponse>({
      url: `${API_BASE}/auth/refresh`, method: 'POST', timeout: 20000,
      data: { refresh_token: session.refreshToken }, header: { 'Content-Type': 'application/json' },
    });
    if (response.statusCode !== 200 || !response.data.access_token) throw new ApiError(401, '登录已失效');
    if (!refreshSession(response.data.access_token, response.data.refresh_token || '', session.token, generation)) {
      throw new ApiError(409, '账号已切换，请重新操作');
    }
  })().finally(() => { if (refreshTask?.promise === promise) refreshTask = undefined; });
  refreshTask = { generation, promise };
  return promise;
};
export const request = async <T>(
  path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  data?: object | string, form = false, retry = true,
): Promise<T> => {
  if (!API_BASE) throw new ApiError(0, '未配置服务器地址');
  try {
    const session = getSession();
    const generation = getSessionGeneration();
    const token = session.token;
    const response = await Taro.request<T>({
      url: `${API_BASE}${path}`, method, data, timeout: 20000,
      header: {
        'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (getSessionGeneration() !== generation) throw new ApiError(409, '账号已切换，请重新操作');
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode === 401 && token && retry
        && !['/auth/token', '/auth/refresh', '/auth/logout', '/auth/logout-all'].includes(path)) {
        try {
          if (getSession().token === token) await refreshAccess();
          if (getSessionGeneration() !== generation) throw new ApiError(409, '账号已切换，请重新操作');
          return await request<T>(path, method, data, form, false);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401 && getSessionGeneration() === generation) logout();
          throw error;
        }
      }
      if (response.statusCode === 401 && token && getSession().token === token) logout();
      console.error('[API]', method, path.split('?')[0], response.statusCode);
      throw new ApiError(response.statusCode,
        response.statusCode === 401 ? '登录已失效，请重新登录' : errorText(response.data));
    }
    return response.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('[API] Network error', method, path.split('?')[0]);
    throw new ApiError(0, '网络连接失败，请检查网络后重试');
  }
};
export const showError = (error: unknown) => {
  console.error('[UI] Operation failed', error instanceof ApiError ? error.status : 'unknown');
  void Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' });
};
export const mediaUrl = (value?: string) => {
  const url = (value || '').trim();
  if (!url) return '';
  // Seed images may retain the former API host. Serve backend-owned static paths locally.
  const staticPath = url.match(/^https?:\/\/(?:123\.57\.67\.153|192\.168\.43\.168|127\.0\.0\.1|localhost)(?::\d+)?(\/static\/.*)$/)?.[1];
  if (staticPath) return `${API_BASE}${staticPath}`;
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE}/${url.replace(/^\/+/, '')}`;
};
export const upload = async (filePath: string, kind: 'avatar' | ItemKind | 'chat', retry = true): Promise<UploadResult> => {
  const session = getSession();
  const generation = getSessionGeneration();
  const token = session.token;
  if (!token) throw new ApiError(401, '请先登录');
  const path = kind === 'avatar' ? '/upload/avatar' : `/${kind}/upload`;
  const result = await Taro.uploadFile({
    url: `${API_BASE}${path}`, filePath, name: 'file',
    header: { Authorization: `Bearer ${token}` }, timeout: 60000,
  });
  if (getSessionGeneration() !== generation) throw new ApiError(409, '账号已切换，请重新上传');
  if (result.statusCode === 401 && retry) {
    try {
      if (getSession().token === token) await refreshAccess();
      if (getSessionGeneration() !== generation) throw new ApiError(409, '账号已切换，请重新上传');
      return await upload(filePath, kind, false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && getSessionGeneration() === generation) logout();
      throw error;
    }
  }
  let data: UploadResult;
  try { data = JSON.parse(result.data) as UploadResult; }
  catch { throw new ApiError(result.statusCode, '上传响应异常'); }
  if (result.statusCode < 200 || result.statusCode >= 300 || !data.url) {
    if (result.statusCode === 401 && getSession().token === token) logout();
    throw new ApiError(result.statusCode, errorText(data));
  }
  return data;
};
export const resourcePath = (kind: ItemKind) => kind === 'service' ? '/services' : '/experiences';
export const getItem = (kind: ItemKind, id: string) =>
  request<Service | Experience>(`${resourcePath(kind)}/${encodeURIComponent(id)}`);
export const getDiscovery = async (kind: ItemKind, skip = 0, limit = 200) =>
  request<(Service | Experience)[]>(`${resourcePath(kind)}/discovery?skip=${skip}&limit=${limit}`);
export const getAllDiscovery = async (kind: ItemKind): Promise<(Service | Experience)[]> => {
  const items: (Service | Experience)[] = [];
  for (let page = 0; page < 50; page++) {
    const next = await getDiscovery(kind, page * 200);
    items.push(...next);
    if (next.length < 200) break;
  }
  return Array.from(new Map(items.map(item => [item.id, item])).values());
};
export const getOwnItems = async (kind: ItemKind, includeCancelled = false) => {
  const items: (Service | Experience)[] = [];
  for (let skip = 0; skip < 10000; skip += 100) {
    const page = await request<(Service | Experience)[]>(`${resourcePath(kind)}/?skip=${skip}&limit=100`);
    items.push(...page);
    if (page.length < 100) break;
  }
  return includeCancelled ? items : items.filter(item => !item.is_deleted);
};
export const saveItem = async (kind: ItemKind, item: Partial<Service & Experience>, editing: boolean) => {
  const detailPath = `${resourcePath(kind)}/${encodeURIComponent(item.id || '')}`;
  try {
    return await request<Service | Experience>(editing ? detailPath : `${resourcePath(kind)}/`, editing ? 'PUT' : 'POST', item);
  } catch (error) {
    if (editing || !item.id || !(error instanceof ApiError) || ![0, 400, 409].includes(error.status)) throw error;
    // A lost POST response may already have created this stable client ID.
    const existing = await getItem(kind, item.id).catch(() => null);
    const ownerId = kind === 'service' ? (existing as Service | null)?.creator_id : (existing as Experience | null)?.host_id;
    if (!existing || ownerId !== getSession().user?.id) throw error;
    return request<Service | Experience>(detailPath, 'PUT', item);
  }
};
export const deleteItem = (kind: ItemKind, id: string) =>
  request<CatalogItem>(`${resourcePath(kind)}/${encodeURIComponent(id)}`, 'DELETE');
export const hideItemRecord = (kind: ItemKind, id: string) =>
  request<{ hidden: boolean }>(`${resourcePath(kind)}/${encodeURIComponent(id)}/record`, 'DELETE');
export const getCalendar = (id: string) =>
  request<CalendarResponse>(`/services/${encodeURIComponent(id)}/calendar`);
export const saveCalendarDay = (id: string, day: string, value: CalendarClosure) =>
  request<CalendarClosure>(`/services/${encodeURIComponent(id)}/calendar/${encodeURIComponent(day)}`, 'PUT', value);
export const login = async (phone: string, password: string) => {
  const result = await request<TokenResponse>('/auth/token', 'POST',
    `username=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}`, true);
  // The profile request needs the token; login is complete only after it returns.
  setSession(result.access_token, null, result.refresh_token || '');
  const generation = getSessionGeneration();
  try {
    const user = await request<User>('/auth/me');
    if (getSessionGeneration() !== generation) throw new ApiError(409, '账号已切换，请重新登录');
    updateSessionUser(user);
    console.info('[Auth] Login succeeded');
    return user;
  } catch (error) { if (getSessionGeneration() === generation) logout(); throw error; }
};
export const loginWithPhone = async (phone: string, code: string) => {
  const result = await request<AuthResponse>('/auth/phone/login', 'POST', { phone_number: phone, verify_code: code });
  setSession(result.access_token, result.user, result.refresh_token || '');
  return result;
};
export const loginWithWeChat = async () => {
  if (process.env.TARO_ENV !== 'weapp') throw new ApiError(0, '微信快捷登录仅在微信小程序中可用');
  const generation = getSessionGeneration();
  const credential = await Taro.login({});
  if (getSessionGeneration() !== generation) throw new ApiError(409, '账号已切换，请重新登录');
  const result = await request<AuthResponse>('/auth/wechat/miniapp/login', 'POST', { code: credential.code });
  setSession(result.access_token, result.user, result.refresh_token || '');
  return result;
};
export const sendPhoneCode = (phone: string, scene: 'login' | 'register' | 'bind_wechat_phone') =>
  request<{ success: boolean; cooldown_seconds: number }>('/auth/phone/send-code', 'POST', { phone_number: phone, scene });
export const logoutRemote = async (all = false) => {
  const generation = getSessionGeneration();
  try { await request(all ? '/auth/logout-all' : '/auth/logout', 'POST', {}); }
  finally { if (getSessionGeneration() === generation) logout(); }
};
export const getWishlist = () => request<WishlistProfile>('/me/wishlist/profile');
export const saveWishlist = (profile: WishlistProfile) =>
  request<WishlistProfile>('/me/wishlist/profile', 'PUT', profile);
export const getExperienceFavorites = async () =>
  (await request<{ experience_ids: string[] }>('/me/wishlist/experiences')).experience_ids;

let favoriteQueue: Promise<unknown> = Promise.resolve();
const queueFavorite = <T>(operation: () => Promise<T>): Promise<T> => {
  const userId = getSession().user?.id;
  const generation = getSessionGeneration();
  const task = favoriteQueue.catch(() => undefined).then(async () => {
    if (!userId || getSessionGeneration() !== generation) throw new ApiError(401, '请登录后重新收藏');
    return operation();
  });
  favoriteQueue = task;
  return task;
};
// Group edits and favorite toggles share one queue and always read the latest profile.
export const updateWishlist = (update: (profile: WishlistProfile) => WishlistProfile) =>
  queueFavorite(async () => saveWishlist(update(await getWishlist())));
const changeFavorite = (kind: ItemKind, id: string, desired?: boolean, category?: string): Promise<boolean> =>
  queueFavorite(async () => {
    if (kind === 'experience') {
      const ids = await getExperienceFavorites();
      const active = desired ?? !ids.includes(id);
      await request('/me/wishlist/experiences', 'PUT', {
        experience_ids: active ? [...new Set([...ids, id])] : ids.filter(value => value !== id),
      });
      return active;
    }
    const profile = await getWishlist();
    const active = desired ?? !profile.service_ids.includes(id);
    profile.service_ids = active ? [...new Set([...profile.service_ids, id])] : profile.service_ids.filter(value => value !== id);
    if (!active) profile.groups = profile.groups.map(group => ({
      ...group, service_ids: group.service_ids.filter(value => value !== id),
    }));
    else if (category !== undefined) {
      const name = normalizeServiceCategory(category);
      const target = profile.groups.find(group => group.name.toLowerCase() === name.toLowerCase());
      profile.groups = profile.groups.map(group => ({
        ...group, service_ids: group === target
          ? [...new Set([...group.service_ids, id])] : group.service_ids.filter(value => value !== id),
      }));
      if (!target) profile.groups.push({ name, service_ids: [id] });
    }
    await saveWishlist(profile);
    return active;
  });
export const toggleFavorite = (kind: ItemKind, id: string, category?: string) => changeFavorite(kind, id, undefined, category);
export const removeFavorite = (kind: ItemKind, id: string) => changeFavorite(kind, id, false);
export const getConversations = async () => {
  const generation = getSessionGeneration();
  const result = new Map<string, ConversationItem>();
  const pageSize = 100;
  let skip = 0;
  while (true) {
    const page = await request<ConversationItem[]>(`/chat/conversations?skip=${skip}&limit=${pageSize}`);
    if (getSessionGeneration() !== generation) throw new ApiError(409, '账号已切换，请重新加载');
    const previousSize = result.size;
    page.forEach(item => result.set(item.conversation.id, item));
    // Stop on repeated pages as well, for older servers that ignore pagination.
    if (page.length < pageSize || result.size === previousSize) return [...result.values()];
    skip += page.length;
  }
};
export const createConversation = (peerId: string) =>
  request<ConversationItem>(`/chat/conversations/direct/${encodeURIComponent(peerId)}`, 'POST');
export const getMessages = (id: string, before?: number, beforeId?: string) =>
  request<ChatMessage[]>(`/chat/conversations/${encodeURIComponent(id)}/messages?limit=100${before === undefined ? ''
    : `&before=${before}${beforeId ? `&before_id=${encodeURIComponent(beforeId)}` : ''}`}`);
export const getConversationStarter = async (id: string): Promise<string> => {
  let oldest: ChatMessage | undefined;
  let cursor: ChatMessage | undefined;
  for (let page = 0; page < 20; page++) {
    const messages = await request<ChatMessage[]>(`/chat/conversations/${encodeURIComponent(id)}/messages?limit=500${!cursor ? ''
      : `&before=${cursor.created_at}&before_id=${encodeURIComponent(cursor.id)}`}`);
    if (!messages.length) return oldest?.sender_id || '';
    oldest = messages[0];
    if (messages.length < 500) return oldest.sender_id;
    if (cursor && (oldest.created_at > cursor.created_at
      || (oldest.created_at === cursor.created_at && oldest.id >= cursor.id))) break;
    cursor = oldest;
  }
  console.error('[Chat] Starter history exceeds classification limit');
  return '';
};
export const sendMessage = (id: string, body: MessageInput) =>
  request<ChatMessage>(`/chat/conversations/${encodeURIComponent(id)}/messages`, 'POST', {
    ...body, client_message_id: body.client_message_id || uniqueId(),
  });
export const markRead = (id: string, messageId?: string) =>
  request(`/chat/conversations/${encodeURIComponent(id)}/read`, 'POST', { message_id: messageId });
