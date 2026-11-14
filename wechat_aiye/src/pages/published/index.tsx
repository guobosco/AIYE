import React, { useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { ScrollView, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { deleteItem, getOwnItems, showError } from '@/services/api';
import { getSession, requireLogin, useSession } from '@/store/session';
import { useResource } from '@/hooks/useResource';
import { ActionButton, StateView } from '@/components/UI';
import ItemCard from '@/components/ItemCard';
import { reviewLabel } from '@/utils/catalog';
import type { Experience, ItemKind, Service } from '@/types/models';
import styles from './index.module.scss';

export default function PublishedPage() {
  const params = Taro.getCurrentInstance().router?.params || {};
  const [kind, setKind] = useState<ItemKind>(params.kind === 'experience' ? 'experience' : 'service');
  const [status, setStatus] = useState('全部');
  const [busy, setBusy] = useState(false);
  const session = useSession();
  const resource = useResource(async () => {
    if (!getSession().token) return { services: [], experiences: [] };
    const [services, experiences] = await Promise.all([getOwnItems('service'), getOwnItems('experience')]);
    return { services, experiences };
  }, { services: [] as (Service | Experience)[], experiences: [] as (Service | Experience)[] }, session.user?.id || 'guest');
  useDidShow(() => { void resource.refresh(); });
  const items = (kind === 'service' ? resource.data.services : resource.data.experiences)
    .filter(item => status === '全部' || reviewLabel(item) === status).sort((a, b) => b.updated_at - a.updated_at);
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>我发布的</Text>
      <ActionButton small outline onClick={() => { if (requireLogin()) void Taro.navigateTo({ url: `/pages/publish/index?kind=${kind}` }); }}>发布</ActionButton></View>
    {!session.token ? <StateView onLogin={requireLogin} /> : <>
      <ScrollView className={styles.tabs} scrollX><View className={styles.tabRow}>
        {(['service', 'experience'] as ItemKind[]).map(value => <View key={value} className={classnames(styles.tab, kind === value && styles.active)}
          onClick={() => { setKind(value); setStatus('全部'); }}>{value === 'service' ? '服务' : '体验'}</View>)}
      </View></ScrollView>
      <ScrollView className={styles.tabs} scrollX><View className={styles.tabRow}>
        {['全部', '待审核', '已通过', '未通过', ...(kind === 'service' ? ['草稿'] : [])].map(value =>
          <View key={value} className={classnames(styles.tab, status === value && styles.active)} onClick={() => setStatus(value)}>{value}</View>)}
      </View></ScrollView>
      <StateView loading={resource.loading} error={resource.error} empty={!items.length} title="暂无发布内容" onRetry={resource.error ? resource.refresh : undefined} />
      {items.map(item => <View key={item.id} className={styles.section}>
        <Text className={styles.badge}>{reviewLabel(item)}</Text>
        <ItemCard item={item} kind={kind} row />
        {item.review_note && <Text className={styles.subtitle}>审核说明：{item.review_note}</Text>}
        <View className={styles.actions}><View><ActionButton small outline onClick={() => Taro.navigateTo({ url: `/pages/publish/index?kind=${kind}&id=${encodeURIComponent(item.id)}` })}>编辑</ActionButton></View>
          {kind === 'service' && <View><ActionButton small outline onClick={() => Taro.navigateTo({ url: `/pages/calendar/index?id=${encodeURIComponent(item.id)}` })}>日历</ActionButton></View>}
          <View><ActionButton small outline disabled={busy} onClick={async () => {
            const result = await Taro.showModal({ title: '删除发布内容', content: '删除后不再展示，是否继续？' });
            if (!result.confirm) return;
            setBusy(true);
            try { await deleteItem(kind, item.id); await resource.refresh(); }
            catch (error) { showError(error); } finally { setBusy(false); }
          }}>删除</ActionButton></View>
        </View>
      </View>)}
    </>}
  </View>;
}
