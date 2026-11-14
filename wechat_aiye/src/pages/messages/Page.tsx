import React, { useEffect, useState } from 'react';
import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
import { Input, ScrollView, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { getConversations, getConversationStarter } from '@/services/api';
import { getSession, requireLogin, useSession } from '@/store/session';
import { useResource } from '@/hooks/useResource';
import { Avatar, StateView } from '@/components/UI';
import { formatTime } from '@/utils/catalog';
import type { ConversationItem } from '@/types/models';
import styles from '@/styles/page.module.scss';

export default function MessagesPage() {
  const session = useSession();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('全部');
  const [visible, setVisible] = useState(false);
  const [archived, setArchived] = useState<string[]>([]);
  const [starred, setStarred] = useState<string[]>([]);
  const [starters, setStarters] = useState<Record<string, string>>({});
  const [classifying, setClassifying] = useState(false);
  const archiveKey = `aiye.archived.${session.user?.id || 'guest'}`;
  const resource = useResource(() => getSession().token ? getConversations() : Promise.resolve([] as ConversationItem[]), [] as ConversationItem[], archiveKey);
  useDidShow(() => { setVisible(true); setArchived(Taro.getStorageSync<string[]>(archiveKey) || []); void resource.refresh(); });
  useDidHide(() => setVisible(false));
  useEffect(() => {
    setArchived(Taro.getStorageSync<string[]>(archiveKey) || []);
    setStarred(Taro.getStorageSync<string[]>(`aiye.starred.${session.user?.id || 'guest'}`) || []);
    setStarters({});
  }, [archiveKey]);
  useEffect(() => {
    setClassifying(false);
    if (!session.user?.id || !['问询我的', '我问询的'].includes(tab)) return;
    const missing = resource.data.filter(item => !starters[item.conversation.id]);
    if (!missing.length) return;
    let active = true;
    let index = 0;
    setClassifying(true);
    const worker = async () => {
      while (active && index < missing.length) {
        const id = missing[index++].conversation.id;
        try {
          const starter = await getConversationStarter(id);
          if (active && starter) setStarters(current => ({ ...current, [id]: starter }));
        } catch { console.error('[Messages] Inquiry classification unavailable'); }
      }
    };
    void Promise.all([worker(), worker()]).finally(() => { if (active) setClassifying(false); });
    return () => { active = false; };
  }, [tab, session.user?.id, resource.data]);
  useEffect(() => {
    if (!visible || !session.token) return;
    const timer = setInterval(() => { void resource.refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [visible, session.token, resource.refresh]);
  useEffect(() => {
    const unread = resource.data.reduce((sum, item) => sum + (item.member?.unread_count || 0), 0);
    if (unread) void Taro.setTabBarBadge({ index: 2, text: unread > 99 ? '99+' : String(unread) }).catch(() => undefined);
    else void Taro.removeTabBarBadge({ index: 2 }).catch(() => undefined);
  }, [resource.data]);
  const items = resource.data.filter(item => {
    const isArchived = archived.includes(item.conversation.id);
    if (tab === '已归档' ? !isArchived : isArchived) return false;
    if (tab === '未读' && !item.member?.unread_count) return false;
    if (tab === '我问询的' && starters[item.conversation.id] !== session.user?.id) return false;
    if (tab === '问询我的' && (!starters[item.conversation.id] || starters[item.conversation.id] === session.user?.id)) return false;
    if (tab === '用户支持') return false;
    return `${item.peer?.name || item.conversation.title} ${item.conversation.last_message_preview}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => b.conversation.last_message_at - a.conversation.last_message_at);
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>消息</Text><Text className={styles.link}
      onClick={() => Taro.navigateTo({ url: '/pages/search/index?kind=user' })}>找人</Text></View>
    {!session.token ? <StateView onLogin={requireLogin} /> : <>
      <Input className={styles.input} placeholder="搜索会话" value={query} onInput={event => setQuery(event.detail.value)} />
      <View className={styles.section}><ScrollView className={styles.tabs} scrollX><View className={styles.tabRow}>
        {['全部', '问询我的', '我问询的', '用户支持', '未读', '已归档'].map(name => <View key={name} className={classnames(styles.tab, tab === name && styles.active)} onClick={() => setTab(name)}>{name}</View>)}
      </View></ScrollView></View>
      {tab === '用户支持' && <View className={styles.notice}>专属客服会话尚未配置，可在“我的 → 设置”提交意见反馈。</View>}
      <StateView loading={classifying || (resource.loading && !resource.data.length)} error={resource.error}
        empty={!items.length} title="暂无消息" onRetry={resource.error ? resource.refresh : undefined} />
      {items.map(item => <View key={item.conversation.id} className={styles.row}
        onClick={() => Taro.navigateTo({ url: `/pages/thread/index?id=${encodeURIComponent(item.conversation.id)}&peer=${encodeURIComponent(item.peer?.id || '')}` })}
        onLongPress={async () => {
          const result = await Taro.showActionSheet({ itemList: [starred.includes(item.conversation.id) ? '取消标记' : '标记会话',
            tab === '已归档' ? '取消归档' : '归档会话'] }).catch(() => null);
          if (!result) return;
          if (result.tapIndex === 0) {
            const next = starred.includes(item.conversation.id) ? starred.filter(id => id !== item.conversation.id)
              : [...starred, item.conversation.id];
            setStarred(next); Taro.setStorageSync(`aiye.starred.${session.user?.id || 'guest'}`, next); return;
          }
          const next = tab === '已归档' ? archived.filter(id => id !== item.conversation.id) : [...new Set([...archived, item.conversation.id])];
          setArchived(next); Taro.setStorageSync(archiveKey, next);
        }}>
        <Avatar url={item.peer?.photo_url || item.conversation.avatar_url} name={item.peer?.name || item.conversation.title} />
        <View className={styles.rowBody}><Text className={styles.rowTitle}>{starred.includes(item.conversation.id) ? '★ ' : ''}{item.peer?.name || item.conversation.title || '会话'}</Text>
          <Text className={styles.rowMeta}>{item.conversation.last_message_preview || '暂无消息'}</Text></View>
        <View><Text className={styles.muted}>{formatTime(item.conversation.last_message_at)}</Text>
          {!!item.member?.unread_count && <View className={styles.badge}>{item.member.unread_count > 99 ? '99+' : item.member.unread_count}</View>}
        </View>
      </View>)}
    </>}
  </View>;
}
