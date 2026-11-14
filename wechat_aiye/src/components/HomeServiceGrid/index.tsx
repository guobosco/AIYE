import React, { useEffect, useMemo, useState } from 'react';
import Taro, { useDidShow, useResize } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { layoutMeasuredCards, orderMeasuredCards, sameMasonryPrefix, type MasonryLayout } from '@/utils/masonry';
import type { Service } from '@/types/models';
import ItemCard from '@/components/ItemCard';
import { ActionButton } from '@/components/UI';
import styles from './index.module.scss';

interface GridState {
  key: string;
  revision: number;
  signatures: string[];
  layout: MasonryLayout | null;
  pending: boolean;
  error: boolean;
}
let nextGridId = 0;
export default function HomeServiceGrid({ items, favorites, onFavorite }: {
  items: Service[]; favorites: string[]; onFavorite: (id: string, active: boolean) => void;
}) {
  const [gridId] = useState(() => `aiyeHomeServiceGrid${++nextGridId}`);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<GridState>({ key: '', revision: -1, signatures: [],
    layout: null, pending: true, error: false });
  const signatures = items.map(item => JSON.stringify([item.id, item.title, item.category, item.location, item.price_text]));
  const key = `${revision}.${JSON.stringify(signatures)}`;
  const compatible = state.revision === revision && sameMasonryPrefix(state.signatures, signatures);
  useDidShow(() => setRevision(value => value + 1));
  useResize(() => setRevision(value => value + 1));
  useEffect(() => {
    let active = true;
    const ids = items.map(item => item.id);
    const nodeIds = items.map((_, index) => `${gridId}Card${index}`);
    const identity = { key, revision, signatures };
    setState({ ...identity, layout: compatible ? state.layout : null, pending: !!ids.length, error: false });
    const fail = () => {
      if (!active) return;
      active = false;
      clearTimeout(timeout);
      console.error('[HomeServiceGrid] Card measurement unavailable');
      setState({ ...identity, layout: null, pending: false, error: true });
    };
    const timeout = setTimeout(fail, 1500);
    let attempts = 0;
    const measure = () => {
      if (!active || !ids.length) return;
      attempts++;
      let width: unknown;
      let rectangles: unknown;
      try {
        const query = Taro.createSelectorQuery();
        query.select(`#${gridId}`).boundingClientRect((rectangle: unknown) => {
          if (rectangle && typeof rectangle === 'object' && 'width' in rectangle) width = rectangle.width;
        });
        query.selectAll(`#${gridId} .aiyeHomeServiceCard`).boundingClientRect((result: unknown) => { rectangles = result; });
        query.exec(() => {
          if (!active) return;
          const layout = layoutMeasuredCards(ids, width, orderMeasuredCards(nodeIds, rectangles));
          if (!layout) {
            if (attempts < 2) Taro.nextTick(measure);
            else fail();
            return;
          }
          active = false;
          clearTimeout(timeout);
          setState({ ...identity, layout, pending: false, error: false });
        });
      } catch (error) {
        console.error('[HomeServiceGrid] Node query failed', error instanceof Error ? error.message : 'unknown');
        fail();
      }
    };
    if (ids.length) Taro.nextTick(measure);
    else clearTimeout(timeout);
    // A category change or resize must discard callbacks from the previous layout.
    return () => { active = false; clearTimeout(timeout); };
  }, [key, gridId]);
  const current = state.key === key;
  const layout = current || compatible ? state.layout : null;
  const pending = !current || state.pending;
  const positions = useMemo(() => new Map(layout?.positions.map(position => [position.id, position])), [layout]);
  if (!items.length) return null;
  return <View className={styles.wrapper}>
    {pending && !layout && <View className={styles.status}><Text>正在排列服务…</Text></View>}
    {current && state.error && <View className={styles.status}>
      <Text>布局暂时无法更新，当前以双列显示。</Text>
      <ActionButton small outline onClick={() => setRevision(value => value + 1)}>重试</ActionButton>
    </View>}
    <View id={gridId} className={classnames(styles.root, pending && !layout && styles.pending, pending && !!layout && styles.measuring)}
      style={layout ? { height: `${layout.height}px` } : undefined}>
      {items.map((item, index) => {
        const position = positions.get(item.id);
        return <View key={item.id} id={`${gridId}Card${index}`} className={classnames(styles.item, 'aiyeHomeServiceCard', !!layout && styles.positioned,
          pending && !!layout && !position && styles.pending)}
          style={layout ? { left: `${position?.left || 0}px`, top: `${position?.top || 0}px` } : undefined}>
          <ItemCard item={item} kind="service" home favorite={favorites.includes(item.id)}
            onFavorite={value => onFavorite(item.id, value)} />
        </View>;
      })}
    </View>
  </View>;
}
