import { useCallback, useEffect, useRef, useState } from 'react';
import Taro, { usePullDownRefresh } from '@tarojs/taro';

export const useResource = <T>(loader: () => Promise<T>, initial: T, key = '') => {
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
    setLoading(true);
    setError('');
    try {
      const next = await loaderRef.current();
      if (mounted.current && generation.current === version) setData(next);
    } catch (err) {
      console.error('[Resource] Load failed', err instanceof Error ? err.message : 'unknown');
      if (mounted.current && generation.current === version) setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (mounted.current && generation.current === version) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    setData(initialRef.current);
    setDataKey(key);
    void refresh();
    return () => { mounted.current = false; generation.current++; };
  }, [refresh, key]);
  usePullDownRefresh(() => { void refresh().finally(() => Taro.stopPullDownRefresh()); });
  return { data: dataKey === key ? data : initialRef.current, setData,
    loading: loading || dataKey !== key, error: dataKey === key ? error : '', refresh };
};
