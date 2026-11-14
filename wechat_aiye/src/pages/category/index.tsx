import React, { useState } from 'react';
import Taro, { useReachBottom } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { getAllDiscovery } from '@/services/api';
import { categoryOf, sortCatalog } from '@/utils/catalog';
import { useResource } from '@/hooks/useResource';
import ItemCard from '@/components/ItemCard';
import { StateView } from '@/components/UI';
import type { ItemKind, Service, Experience } from '@/types/models';
import styles from './index.module.scss';

export default function CategoryPage() {
  const params = Taro.getCurrentInstance().router?.params || {};
  const kind: ItemKind = params.kind === 'service' ? 'service' : 'experience';
  const category = params.category || '';
  const [limit, setLimit] = useState(30);
  useReachBottom(() => setLimit(value => value + 30));
  const resource = useResource(async () => sortCatalog(await getAllDiscovery(kind))
    .filter(item => !category || categoryOf(item, kind) === category), [] as (Service | Experience)[]);
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>{category || (kind === 'service' ? '服务' : '体验')}</Text></View>
    <StateView loading={resource.loading} error={resource.error} empty={!resource.data.length}
      title="暂无内容" onRetry={resource.error ? resource.refresh : undefined} />
    {resource.data.slice(0, limit).map(item => <ItemCard key={item.id} item={item} kind={kind} row />)}
    {resource.data.length > limit && <Text className={styles.link} onClick={() => setLimit(value => value + 30)}>加载更多</Text>}
  </View>;
}
