import { useEffect, useRef, useState } from 'react';
import { getSessionGeneration, useSession } from '@/store/session';

interface PageOperation { key: string; generation: number }

export const usePageOperation = (scope: string) => {
  useSession();
  const generation = getSessionGeneration();
  const key = `${scope}.${generation}`;
  const latestKey = useRef(key);
  latestKey.current = key;
  const mounted = useRef(true);
  const operation = useRef<PageOperation | null>(null);
  const [pending, setPending] = useState<PageOperation | null>(null);
  const cancel = () => { operation.current = null; setPending(null); };
  useEffect(() => {
    mounted.current = true;
    cancel();
    return () => { mounted.current = false; operation.current = null; };
  }, [key]);
  const active = () => mounted.current && latestKey.current === key && getSessionGeneration() === generation;
  const begin = () => {
    if (!active() || operation.current) return null;
    const task = { key, generation };
    operation.current = task;
    setPending(task);
    return task;
  };
  const isCurrent = (task: PageOperation) => active() && operation.current === task;
  const finish = (task: PageOperation) => {
    // An old finally must not unlock a replacement operation.
    if (operation.current !== task) return;
    operation.current = null;
    if (active()) setPending(null);
  };
  return { begin, isCurrent, finish, cancel, active, busy: pending?.key === key };
};
