import React, { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import type { Experience, ItemKind, Service } from '@/types/models';
import { mediaUrl, showError, toggleFavorite } from '@/services/api';
import { getSessionGeneration, requireLogin, useSession } from '@/store/session';
import { categoryOf, cityLocation, homeMeta, homeServiceCoverHeight, itemUrl } from '@/utils/catalog';
import styles from './index.module.scss';

export default function ItemCard({ item, kind, row = false, home = false, favorite, onFavorite }: {
  item: Service | Experience; kind: ItemKind; row?: boolean; home?: boolean;
  favorite?: boolean; onFavorite?: (active: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  useSession();
  const identity = `${getSessionGeneration()}.${kind}.${item.id}`;
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const operation = useRef<{ identity: string } | null>(null);
  const mounted = useRef(true);
  const [busyIdentity, setBusyIdentity] = useState<string | null>(null);
  const busy = busyIdentity === identity;
  const cover = mediaUrl(item.cover_image_url || item.image_urls?.[0]);
  useEffect(() => setFailed(false), [cover]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const experience = item as Experience;
  const toggle = async () => {
    if (operation.current?.identity === identity || !requireLogin()) return;
    const generation = getSessionGeneration();
    const task = { identity };
    operation.current = task;
    setBusyIdentity(identity);
    const current = () => mounted.current && operation.current === task
      && latestIdentity.current === identity && getSessionGeneration() === generation;
    try {
      const active = await toggleFavorite(kind, item.id, home && kind === 'service' ? item.category || '' : undefined);
      if (current()) {
        onFavorite?.(active);
        void Taro.showToast({ title: active ? '已加入心愿单' : '已移出心愿单', icon: 'none' });
      }
    } catch (error) { if (current()) showError(error); }
    finally {
      if (operation.current === task) {
        operation.current = null;
        if (mounted.current) setBusyIdentity(null);
      }
    }
  };
  return <View className={classnames(styles.card, row && styles.row,
    home && kind === 'service' && styles.serviceHome, home && kind === 'experience' && styles.experienceHome)}
    onClick={() => Taro.navigateTo({ url: itemUrl(kind, item.id) })}>
    <View className={styles.cover} style={home && kind === 'service' ? { height: Taro.pxTransform(homeServiceCoverHeight(item.id)) } : undefined}>
      {cover && !failed ? <Image src={cover} mode="aspectFill" lazyLoad className={styles.image}
        onError={() => { console.error('[ItemCard] Image failed', item.id); setFailed(true); }} />
        : <View className={styles.missing}>暂无图片</View>}
      {kind === 'experience' && home && <Text className={styles.badge}>{experience.badge_text || item.category}</Text>}
      {kind === 'service' && favorite !== undefined && <View className={classnames(styles.favorite, favorite && styles.active)}
        onClick={event => { event.stopPropagation(); void toggle(); }}>{busy ? '…' : favorite ? '♥' : '♡'}</View>}
    </View>
    <View className={styles.body}>
      <Text className={styles.title}>{item.title}</Text>
      <Text className={styles.meta}>{home && kind === 'experience' ? homeMeta(item)
        : home && kind === 'service' ? [categoryOf(item, kind), cityLocation(item.location)].join(' · ')
          : [cityLocation(item.location), kind === 'experience' ? experience.duration_text : item.category].filter(Boolean).join(' · ')}</Text>
      {!(home && kind === 'experience') && <Text className={styles.price}>{item.price_text || '价格待沟通'}</Text>}
    </View>
  </View>;
}
