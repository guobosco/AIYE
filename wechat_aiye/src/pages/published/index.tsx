import React, { useEffect, useState } from 'react';
import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
import { Input, ScrollView, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { deleteItem, getOwnItems, showError } from '@/services/api';
import { getSession, requireLogin, useSession } from '@/store/session';
import { useResource } from '@/hooks/useResource';
import { usePageOperation } from '@/hooks/usePageOperation';
import { ActionButton, StateView } from '@/components/UI';
import ItemCard from '@/components/ItemCard';
import { reviewLabel } from '@/utils/catalog';
import { onboardingDestination } from '@/utils/authentication';
import type { Experience, ItemKind, Service } from '@/types/models';
import styles from './index.module.scss';

export default function PublishedPage() {
  const params = Taro.getCurrentInstance().router?.params || {};
  const [kind, setKind] = useState<ItemKind>(params.kind === 'experience' ? 'experience' : 'service');
  const [status, setStatus] = useState('全部');
  const [search, setSearch] = useState('');
  const session = useSession();
  const operation = usePageOperation(`published.${kind}`);
  const canRead = !!session.token && !!session.user && !onboardingDestination(session.user);
  const resource = useResource(async () => {
    if (!canRead) return { services: [], experiences: [] };
    const [services, experiences] = await Promise.all([getOwnItems('service', true), getOwnItems('experience', true)]);
    return { services, experiences };
  }, { services: [] as (Service | Experience)[], experiences: [] as (Service | Experience)[] }, `${session.user?.id || 'guest'}.${canRead}`);
  useEffect(() => { setStatus('全部'); setSearch(''); }, [session.user?.id, canRead]);
  useDidShow(() => { if (session.token && !canRead) requireLogin(); void resource.refresh(); });
  useDidHide(operation.cancel);
  const label = (item: Service | Experience) => item.is_deleted ? '已取消' : reviewLabel(item);
  const keyword = search.trim().toLocaleLowerCase();
  const items = (kind === 'service' ? resource.data.services : resource.data.experiences)
    .filter(item => (status === '全部' || label(item) === status) && (!keyword
      || [item.title, item.category, item.location].some(value => value?.toLocaleLowerCase().includes(keyword))))
    .sort((a, b) => b.updated_at - a.updated_at);
  const cancelPublication = async (item: Service | Experience) => {
    if (!requireLogin() || item.is_deleted) return;
    const task = operation.begin();
    if (!task) return;
    const targetKind = kind;
    try {
      const result = await Taro.showModal({ title: '取消发布',
        content: `确定下架${targetKind === 'service' ? '服务' : '体验'}“${item.title}”？下架后不再公开展示，记录保留在“已取消”，不会撤回聊天问询。`,
        confirmText: '确定下架' });
      if (!result.confirm || !operation.isCurrent(task)) return;
      const cancelled = await deleteItem(targetKind, item.id);
      if (!operation.isCurrent(task)) return;
      if (!cancelled.is_deleted) throw new Error('下架结果未确认，请刷新后检查');
      resource.setData(current => {
        const field = targetKind === 'service' ? 'services' : 'experiences';
        return { ...current, [field]: current[field].map(value => value.id === item.id ? { ...value, ...cancelled } : value) };
      });
      void Taro.showToast({ title: '已取消发布', icon: 'none' });
    } catch (error) { if (operation.isCurrent(task)) showError(error); }
    finally { operation.finish(task); }
  };
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>我发布的</Text>
      <ActionButton small outline disabled={operation.busy} onClick={() => { if (operation.active() && !operation.busy && requireLogin()) void Taro.navigateTo({ url: `/pages/publish/index?kind=${kind}` }); }}>发布</ActionButton></View>
    {!session.token ? <StateView onLogin={requireLogin} /> : !canRead ? <>
      <StateView empty title="请先完成账号验证和资料" /><ActionButton onClick={requireLogin}>继续完善账号</ActionButton>
    </> : <>
      <View className={styles.search}><Input className={styles.input} value={search} maxlength={100}
        placeholder="搜索标题、类目或地点" onInput={event => setSearch(event.detail.value)} /></View>
      <ScrollView className={styles.tabs} scrollX><View className={styles.tabRow}>
        {(['service', 'experience'] as ItemKind[]).map(value => <View key={value} className={classnames(styles.tab, kind === value && styles.active)}
          onClick={() => { if (!operation.busy) { setKind(value); setStatus('全部'); } }}>{value === 'service' ? '服务' : '体验'}</View>)}
      </View></ScrollView>
      <ScrollView className={styles.tabs} scrollX><View className={styles.tabRow}>
        {['全部', '待审核', '已通过', '未通过', ...(kind === 'service' ? ['草稿'] : []), '已取消'].map(value =>
          <View key={value} className={classnames(styles.tab, status === value && styles.active)} onClick={() => setStatus(value)}>{value}</View>)}
      </View></ScrollView>
      <StateView loading={resource.loading} error={resource.error} empty={!items.length} title="暂无发布内容" onRetry={resource.error ? resource.refresh : undefined} />
      {items.map(item => <View key={item.id} className={styles.section}>
        <Text className={styles.badge}>{label(item)}</Text>
        {item.is_deleted ? <View className={styles.cancelledRecord}>
          <Text className={styles.rowTitle}>{item.title}</Text><Text className={styles.rowMeta}>{item.category} · {item.location}</Text>
          <Text className={styles.subtitle}>已下架，保留管理记录；暂不支持永久删除或恢复发布。</Text>
        </View> : <ItemCard item={item} kind={kind} row />}
        {item.review_note && <Text className={styles.subtitle}>审核说明：{item.review_note}</Text>}
        {!item.is_deleted && <View className={styles.actions}><View><ActionButton small outline disabled={operation.busy} onClick={() => {
          if (operation.active() && !operation.busy && requireLogin()) void Taro.navigateTo({ url: `/pages/publish/index?kind=${kind}&id=${encodeURIComponent(item.id)}` });
        }}>编辑</ActionButton></View>
          {kind === 'service' && <View><ActionButton small outline onClick={() => Taro.navigateTo({ url: `/pages/calendar/index?id=${encodeURIComponent(item.id)}` })}>日历</ActionButton></View>}
          <View><ActionButton small outline disabled={operation.busy} onClick={() => void cancelPublication(item)}>取消发布</ActionButton></View>
        </View>}
      </View>)}
    </>}
  </View>;
}
