import React, { useEffect, useState } from 'react';
import Taro, { useDidHide, useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Image, Input, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { getActivity, cancelBooking, clearActivity } from '@/store/activity';
import { mediaUrl, showError } from '@/services/api';
import { getSessionGeneration, requireLogin, useSession } from '@/store/session';
import { onboardingDestination } from '@/utils/authentication';
import { usePageOperation } from '@/hooks/usePageOperation';
import { ActionButton, StateView } from '@/components/UI';
import { itemUrl } from '@/utils/catalog';
import type { ActivityRecord } from '@/types/models';
import styles from './index.module.scss';

export default function ActivityPage() {
  const type = Taro.getCurrentInstance().router?.params?.type === 'booked' ? 'booked' : 'viewed';
  const session = useSession();
  const viewKey = `${type}.${getSessionGeneration()}`;
  const operation = usePageOperation(`activity.${type}`);
  const canRead = type === 'viewed' || (!!session.token && !!session.user && !onboardingDestination(session.user));
  const [loaded, setLoaded] = useState({ key: '', records: [] as ActivityRecord[], error: '' });
  const [search, setSearch] = useState('');
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const records = canRead && loaded.key === viewKey ? loaded.records : [];
  const error = loaded.key === viewKey ? loaded.error : '';
  const load = () => {
    if (!operation.active()) return;
    if (!canRead) { setLoaded({ key: viewKey, records: [], error: '' }); return; }
    try { setLoaded({ key: viewKey, records: getActivity(type), error: '' }); }
    catch (error) {
      console.error('[Activity] Read failed', error);
      setLoaded({ key: viewKey, records: [], error: error instanceof Error ? error.message : '本机记录读取失败' });
    }
  };
  useEffect(() => { setSearch(''); setUpcomingOnly(true); load(); }, [viewKey, canRead]);
  useDidShow(() => {
    load();
    if (type === 'booked' && !canRead) requireLogin();
    void Taro.setNavigationBarTitle({ title: type === 'booked' ? '我预定的' : '我浏览的' });
  });
  useDidHide(operation.cancel);
  usePullDownRefresh(() => { load(); void Taro.stopPullDownRefresh(); });
  const mutate = async (record?: ActivityRecord) => {
    if (!canRead || (type === 'booked' && !requireLogin())) return;
    const task = operation.begin();
    if (!task) return;
    try {
      const result = await Taro.showModal(record
        ? { title: '标记取消', content: '仅更新本机问询记录，请另行联系主理人确认取消。' }
        : { title: '清空浏览记录', content: '仅清空当前账号的全部本机浏览记录，包括未显示的搜索结果。' });
      if (!result.confirm || !operation.isCurrent(task)) return;
      if (record) cancelBooking(record.id); else clearActivity(type);
      load();
    } catch (error) {
      console.error('[Activity] Update failed', error);
      if (operation.isCurrent(task)) showError(error);
    } finally { operation.finish(task); }
  };
  const keyword = search.trim().toLocaleLowerCase();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const filtered = records.filter(record => (!keyword
    || [record.title, record.location, record.category, record.host_name].some(value => value?.toLocaleLowerCase().includes(keyword)))
    && (type !== 'booked' || !upcomingOnly || (record.scheduled_at ?? record.recorded_at) >= today.getTime()));
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>{type === 'booked' ? '我预定的' : '我浏览的'}</Text>
      {type === 'viewed' && !!records.length && <ActionButton small outline disabled={operation.busy} onClick={() => void mutate()}>清空</ActionButton>}
    </View>
    {type === 'booked' && <View className={styles.notice}>这里是本机保存的问询记录，不代表订单已确认或已支付。</View>}
    {!canRead ? <><StateView empty title="请先登录并完成账号资料" /><ActionButton onClick={requireLogin}>继续完善账号</ActionButton></> : <>
    <View className={styles.search}><Input className={styles.input} value={search} maxlength={100}
      placeholder="搜索标题、地点、类目或主理人" onInput={event => setSearch(event.detail.value)} /></View>
    {type === 'booked' && <View className={styles.filters}>
      {[true, false].map(value => <View key={String(value)} className={classnames(styles.filter, upcomingOnly === value && styles.selected)}
        onClick={() => setUpcomingOnly(value)}>{value ? '待出行' : '全部'}</View>)}
    </View>}
    <StateView error={error} onRetry={error ? load : undefined} empty={!filtered.length}
      title={keyword ? '没有匹配的记录' : type === 'booked' ? '暂无问询记录' : '暂无浏览记录'} />
    {filtered.map(record => <View key={record.id} className={styles.section}>
      <View className={styles.row} onClick={() => {
        if (operation.idle()) void Taro.navigateTo({ url: itemUrl(record.kind, record.item_id) });
      }}>
        {record.cover_image_url ? <Image src={mediaUrl(record.cover_image_url)} mode="aspectFill" className={styles.photo}
          onError={() => console.error('[Activity] Image failed')} /> : <View className={styles.missingPhoto}>暂无图片</View>}
        <View className={styles.rowBody}><Text className={styles.rowTitle}>{record.title}</Text>
          <Text className={styles.rowMeta}>{record.location}</Text><Text className={styles.rowMeta}>{record.price_text}</Text>
          <Text className={styles.rowMeta}>{new Date(record.scheduled_at ?? record.recorded_at).toLocaleString()}</Text></View>
      </View>
      {type === 'booked' && <><Text className={styles.badge}>{record.status === 'cancelled' ? '已标记取消' : '待沟通确认'}</Text>
        <View className={styles.actions}>
          <View><ActionButton small outline disabled={operation.busy || !record.conversation_id} onClick={() => {
            if (operation.idle() && requireLogin() && record.conversation_id) void Taro.navigateTo({
              url: `/pages/thread/index?id=${encodeURIComponent(record.conversation_id)}&peer=${encodeURIComponent(record.host_id || '')}&${record.kind}=${encodeURIComponent(record.item_id)}`,
            });
          }}>联系主理人</ActionButton></View>
          {record.status !== 'cancelled' && <View><ActionButton small outline disabled={operation.busy}
            onClick={() => void mutate(record)}>标记取消</ActionButton></View>}
        </View></>}
    </View>)}</>}
  </View>;
}
