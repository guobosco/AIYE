import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import type { User } from '@/types/models';

const KEY = 'aiye.session.v1';
const EVENT = 'aiye.session.changed';
interface Session { token: string; user: User | null; refreshToken?: string }
let cached: Session | undefined;

export const getSession = (): Session => {
  if (!cached) {
    const stored = Taro.getStorageSync<Session>(KEY);
    cached = stored && typeof stored.token === 'string'
      ? stored : { token: '', user: null };
  }
  return cached;
};
export const setSession = (token: string, user: User | null, refreshToken = cached?.refreshToken || '') => {
  cached = { token, user, refreshToken: token ? refreshToken : '' };
  if (token) Taro.setStorageSync(KEY, cached);
  else Taro.removeStorageSync(KEY);
  Taro.eventCenter.trigger(EVENT);
};
export const updateSessionUser = (user: User) => setSession(getSession().token, user);
export const logout = () => setSession('', null);
export const requireLogin = () => {
  if (getSession().token) return true;
  void Taro.navigateTo({ url: '/pages/login/index' });
  return false;
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
