import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import type { User } from '@/types/models';
import { onboardingDestination } from '@/utils/authentication';

const KEY = 'aiye.session.v1';
const EVENT = 'aiye.session.changed';
interface Session { token: string; user: User | null; refreshToken?: string }
let cached: Session | undefined;
let generation = 0;
let gateNavigation: { generation: number; route: string; promise: Promise<unknown> } | undefined;
const openAccountPage = (route: string) => {
  if (gateNavigation?.generation === generation && gateNavigation.route === route) return;
  const promise = Taro.navigateTo({ url: route })
    .catch(error => console.error('[Auth] Account navigation failed', error))
    .finally(() => { if (gateNavigation?.promise === promise) gateNavigation = undefined; });
  gateNavigation = { generation, route, promise };
};

export const getSession = (): Session => {
  if (!cached) {
    const stored = Taro.getStorageSync<Session>(KEY);
    cached = stored && typeof stored.token === 'string'
      ? stored : { token: '', user: null };
  }
  return cached;
};
export const getSessionGeneration = () => generation;
const persistSession = (token: string, user: User | null, refreshToken: string) => {
  cached = { token, user, refreshToken: token ? refreshToken : '' };
  if (token) Taro.setStorageSync(KEY, cached);
  else Taro.removeStorageSync(KEY);
  Taro.eventCenter.trigger(EVENT);
};
export const setSession = (token: string, user: User | null, refreshToken = cached?.refreshToken || '') => {
  generation++;
  persistSession(token, user, refreshToken);
};
// Token rotation belongs to the same login; a new login or logout invalidates old work.
export const refreshSession = (token: string, refreshToken: string, expectedToken: string, expectedGeneration: number) => {
  const session = getSession();
  if (generation !== expectedGeneration || session.token !== expectedToken) return false;
  persistSession(token, session.user, refreshToken);
  return true;
};
export const updateSessionUser = (user: User) => {
  const session = getSession();
  persistSession(session.token, user, session.refreshToken || '');
};
export const logout = () => setSession('', null);
export const requireSession = () => {
  if (getSession().token) return true;
  openAccountPage('/pages/login/index');
  return false;
};
export const requireLogin = () => {
  if (!requireSession()) return false;
  const route = onboardingDestination(getSession().user);
  if (!route) return true;
  openAccountPage(route);
  return false;
};
export const finishAccountFlow = async (user: User, expectedGeneration: number, requiresBinding = false) => {
  if (generation !== expectedGeneration || getSession().user?.id !== user.id || !getSession().token) {
    throw new Error('登录状态已变化，请重试');
  }
  const route = onboardingDestination(user, requiresBinding);
  if (route) {
    await Taro.redirectTo({ url: route });
    return;
  }
  try { await Taro.navigateBack({}); }
  catch (error) {
    console.info('[Auth] No previous page; opening account tab');
    if (generation === expectedGeneration) await Taro.switchTab({ url: '/pages/mine/index' });
  }
};
export const useSession = () => {
  const [session, setValue] = useState(getSession);
  useEffect(() => {
    const sync = () => setValue({ ...getSession() });
    Taro.eventCenter.on(EVENT, sync);
    return () => { Taro.eventCenter.off(EVENT, sync); };
  }, []);
  return session;
};
