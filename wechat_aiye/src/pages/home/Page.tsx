import React, { useMemo, useState } from 'react';
import Taro, { useDidShow, useReachBottom } from '@tarojs/taro';
import { ScrollView, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { getAllDiscovery, getWishlist } from '@/services/api';
import { useResource } from '@/hooks/useResource';
import { getSession } from '@/store/session';
import { categoryOf, experienceSections, SERVICE_CATEGORIES, sortCatalog } from '@/utils/catalog';
import ItemCard from '@/components/ItemCard';
import HomeServiceGrid from '@/components/HomeServiceGrid';
import { ActionButton, StateView } from '@/components/UI';
import type { Experience, ItemKind, Service } from '@/types/models';
import styles from './index.module.scss';

export default function HomePage() {
  const [tab, setTab] = useState<ItemKind>('experience');
  const [category, setCategory] = useState('全部');
  const [renderWindow, setRenderWindow] = useState({ key: '全部', size: 30 });
  const favoriteResource = useResource(async () => getSession().token
    ? (await getWishlist()).service_ids : [], [] as string[], 'home-favorites');
  const resource = useResource(async () => {
    const [experiences, services] = await Promise.all([getAllDiscovery('experience'), getAllDiscovery('service')]);
    return { experiences: experiences as Experience[], services: sortCatalog(services as Service[]) };
  }, { experiences: [] as Experience[], services: [] as Service[] });
  useDidShow(() => {
    void favoriteResource.refresh();
  });
  const groups = useMemo(() => experienceSections(resource.data.experiences), [resource.data.experiences]);
  const services = useMemo(() => resource.data.services.filter(item =>
    category === '全部' || categoryOf(item, 'service') === category), [category, resource.data.services]);
  const serviceLimit = renderWindow.key === category ? renderWindow.size : 30;
  const loadMore = () => setRenderWindow({ key: category, size: Math.min(services.length, serviceLimit + 30) });
  useReachBottom(() => { if (tab === 'service' && services.length > serviceLimit) loadMore(); });
  const setFavorite = (id: string, active: boolean) => favoriteResource.setData(values =>
    active ? [...new Set([...values, id])] : values.filter(value => value !== id));
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
      ? groups.map(([name, items], index) => <View key={name} className={classnames(styles.experienceSection, index === 0 && styles.firstSection)}>
        <View className={styles.experienceHeader} onClick={() => Taro.navigateTo({
          url: `/pages/category/index?kind=experience&category=${encodeURIComponent(name)}`,
        })}><Text className={styles.experienceTitle}>{name}</Text><View className={styles.sectionMore}><Text>›</Text></View></View>
        <ScrollView scrollX showScrollbar={false}><View className={styles.experienceRow}>
          {items.slice(0, 10).map(item => <View key={item.id} className={styles.experienceCard}><ItemCard item={item} kind="experience" home /></View>)}
        </View></ScrollView>
      </View>)
      : <View>
        {favoriteResource.error && <View className={styles.loadMore}>
          <Text>心愿单暂时无法同步</Text>
          <ActionButton small outline onClick={favoriteResource.refresh}>重试</ActionButton>
        </View>}
        <View className={styles.waterfall}><HomeServiceGrid items={services.slice(0, serviceLimit)}
          favorites={favoriteResource.data} onFavorite={setFavorite} /></View>
        {services.length > serviceLimit && <View className={styles.loadMore}>
          <ActionButton outline onClick={loadMore}>加载更多服务</ActionButton>
        </View>}
      </View>)}
  </View>;
}
