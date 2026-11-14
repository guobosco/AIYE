import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { getSessionGeneration, useSession } from '@/store/session';

export const useResource = <T>(loader: () => Promise<T>, initial: T, resourceKey = '') => {
  useSession();
  const key = `${resourceKey}.${getSessionGeneration()}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const initialRef = useRef(initial);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const generation = useRef(0);
  const mounted = useRef(true);
  const [data, setData] = useState<T>(initial);
  const [dataKey, setDataKey] = useState(key);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    const requestKey = keyRef.current;
    const current = () => mounted.current && generation.current === version && keyRef.current === requestKey;
    setLoading(true);
    setError('');
    try {
      const next = await loaderRef.current();
      if (current()) setData(next);
    } catch (err) {
      console.error('[Resource] Load failed', err instanceof Error ? err.message : 'unknown');
      if (current()) setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (current()) setLoading(false);
    }
  }, []);
  const sessionGeneration = getSessionGeneration();
  const replaceData = useCallback((next: SetStateAction<T>) => {
    if (!mounted.current || keyRef.current !== key || getSessionGeneration() !== sessionGeneration) return;
    // A confirmed mutation must not be overwritten by an older in-flight read.
    generation.current++;
    setData(next);
    setDataKey(key);
    setLoading(false);
    setError('');
  }, [key, sessionGeneration]);
  useEffect(() => {
    mounted.current = true;
    setData(initialRef.current);
    setDataKey(key);
    void refresh();
    return () => { mounted.current = false; generation.current++; };
  }, [refresh, key]);
  usePullDownRefresh(() => { void refresh().finally(() => Taro.stopPullDownRefresh()); });
  return { data: dataKey === key ? data : initialRef.current, setData: replaceData,
    loading: loading || dataKey !== key, error: dataKey === key ? error : '', refresh };
};
