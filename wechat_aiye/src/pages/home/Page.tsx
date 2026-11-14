import React, { useMemo, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { ScrollView, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { getAllDiscovery, getWishlist, showError } from '@/services/api';
import { useResource } from '@/hooks/useResource';
import { getSession } from '@/store/session';
import { categoryOf, SERVICE_CATEGORIES, sortCatalog } from '@/utils/catalog';
import ItemCard from '@/components/ItemCard';
import { StateView } from '@/components/UI';
import type { Experience, ItemKind, Service } from '@/types/models';
import styles from './index.module.scss';

export default function HomePage() {
  const [tab, setTab] = useState<ItemKind>('experience');
  const [category, setCategory] = useState('全部');
  const [favorites, setFavorites] = useState<string[]>([]);
  const resource = useResource(async () => {
    const [experiences, services] = await Promise.all([getAllDiscovery('experience'), getAllDiscovery('service')]);
    return { experiences: sortCatalog(experiences as Experience[]), services: sortCatalog(services as Service[]) };
  }, { experiences: [] as Experience[], services: [] as Service[] });
  useDidShow(() => {
    if (getSession().token) void getWishlist().then(profile => setFavorites(profile.service_ids)).catch(showError);
    else setFavorites([]);
  });
  const groups = useMemo(() => {
    const map = new Map<string, Experience[]>();
    resource.data.experiences.forEach(item => {
      const name = categoryOf(item, 'experience');
      map.set(name, [...(map.get(name) || []), item]);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
  }, [resource.data.experiences]);
  const services = resource.data.services.filter(item => category === '全部' || categoryOf(item, 'service') === category);
  const setFavorite = (id: string, active: boolean) => setFavorites(values => active ? [...values, id] : values.filter(value => value !== id));
  return <View className={styles.page}>
    <View className={styles.topBar}>
      <View className={styles.topBarPlaceholder} />
      <View className={styles.tabSwitch}>{(['experience', 'service'] as ItemKind[]).map(kind =>
        <View key={kind} className={styles.topTab} onClick={() => setTab(kind)}>
          <Text className={classnames(styles.topTabText, tab === kind && styles.topTabTextActive)}>{kind === 'experience' ? '体验' : '服务'}</Text>
          <View className={classnames(styles.topTabLine, tab === kind && styles.topTabLineActive)} />
        </View>)}</View>
      <View className={styles.topBarAction} onClick={() => Taro.navigateTo({ url: `/pages/search/index?kind=${tab}` })}>
        <View className={styles.searchIcon}><View className={styles.searchIconCircle} /><View className={styles.searchIconHandle} /></View>
      </View>
    </View>
    {tab === 'service' && <ScrollView scrollX showScrollbar={false} className={styles.filterScroll}>
      <View className={styles.filterRow}>{['全部', ...SERVICE_CATEGORIES].map(name =>
        <View key={name} className={category === name ? styles.filterChipActive : styles.filterChip} onClick={() => setCategory(name)}>{name}</View>)}</View>
    </ScrollView>}
    <StateView loading={resource.loading} error={resource.error}
      empty={tab === 'experience' ? !groups.length : !services.length} title={tab === 'experience' ? '暂无体验' : '暂无服务'}
      onRetry={resource.error ? resource.refresh : undefined} />
    {!resource.error && (tab === 'experience'
      ? groups.map(([name, items]) => <View key={name} className={styles.experienceSection}>
        <View className={styles.experienceHeader} onClick={() => Taro.navigateTo({
          url: `/pages/category/index?kind=experience&category=${encodeURIComponent(name)}`,
        })}><Text className={styles.experienceTitle}>{name}</Text><View className={styles.sectionMore}><Text>›</Text></View></View>
        <ScrollView scrollX showScrollbar={false}><View className={styles.experienceRow}>
          {items.slice(0, 10).map(item => <View key={item.id} className={styles.experienceCard}><ItemCard item={item} kind="experience" home /></View>)}
        </View></ScrollView>
      </View>)
      : <View className={styles.waterfall}>{[0, 1].map(column =>
        <View key={column} className={styles.waterfallColumn}>
          {services.filter((_, index) => index % 2 === column).map(item => <View key={item.id} className={styles.feedCard}>
            <ItemCard item={item} kind="service" home favorite={favorites.includes(item.id)} onFavorite={active => setFavorite(item.id, active)} />
          </View>)}
        </View>)}</View>)}
  </View>;
}
