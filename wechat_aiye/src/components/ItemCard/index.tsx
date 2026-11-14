import React, { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import type { Experience, ItemKind, Service } from '@/types/models';
import { mediaUrl, showError, toggleFavorite } from '@/services/api';
import { requireLogin } from '@/store/session';
import { cityLocation, homeMeta, itemUrl } from '@/utils/catalog';
import styles from './index.module.scss';

export default function ItemCard({ item, kind, row = false, home = false, favorite, onFavorite }: {
  item: Service | Experience; kind: ItemKind; row?: boolean; home?: boolean;
  favorite?: boolean; onFavorite?: (active: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const cover = mediaUrl(item.cover_image_url || item.image_urls?.[0]);
  useEffect(() => setFailed(false), [cover]);
  const experience = item as Experience;
  const toggle = async () => {
    if (busy || !requireLogin()) return;
    setBusy(true);
    try { onFavorite?.(await toggleFavorite(kind, item.id)); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  return <View className={classnames(styles.card, row && styles.row)}
    onClick={() => Taro.navigateTo({ url: itemUrl(kind, item.id) })}>
    <View className={styles.cover}>
      {cover && !failed ? <Image src={cover} mode="aspectFill" lazyLoad className={styles.image}
        onError={() => { console.error('[ItemCard] Image failed', item.id); setFailed(true); }} />
        : <View className={styles.missing}>暂无图片</View>}
      {kind === 'experience' && home && <Text className={styles.badge}>{experience.badge_text || item.category}</Text>}
      {kind === 'service' && favorite !== undefined && <View className={classnames(styles.favorite, favorite && styles.active)}
        onClick={event => { event.stopPropagation(); void toggle(); }}>{favorite ? '♥' : '♡'}</View>}
    </View>
    <View className={styles.body}>
      <Text className={styles.title}>{item.title}</Text>
      <Text className={styles.meta}>{home && kind === 'experience' ? homeMeta(item)
        : [cityLocation(item.location), kind === 'experience' ? experience.duration_text : item.category].filter(Boolean).join(' · ')}</Text>
      {!(home && kind === 'experience') && <Text className={styles.price}>{item.price_text || '价格待沟通'}</Text>}
    </View>
  </View>;
}
