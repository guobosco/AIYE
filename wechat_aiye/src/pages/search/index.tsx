import React, { useRef, useState } from 'react';
import Taro, { useReachBottom } from '@tarojs/taro';
import { Input, ScrollView, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { getAllDiscovery, request, showError } from '@/services/api';
import { requireLogin } from '@/store/session';
import { useResource } from '@/hooks/useResource';
import ItemCard from '@/components/ItemCard';
import { ActionButton, Avatar, StateView, Tags } from '@/components/UI';
import { sortCatalog } from '@/utils/catalog';
import type { Experience, Service, User } from '@/types/models';
import styles from './index.module.scss';

export default function SearchPage() {
  const initial = Taro.getCurrentInstance().router?.params?.kind || 'experience';
  const [tab, setTab] = useState(initial);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>(() => Taro.getStorageSync<string[]>('aiye.search.history') || []);
  const [user, setUser] = useState<User | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [searchedUser, setSearchedUser] = useState(false);
  const [limit, setLimit] = useState(30);
  const searchGeneration = useRef(0);
  useReachBottom(() => setLimit(value => value + 30));
  const resource = useResource(async () => {
    const [services, experiences] = await Promise.all([getAllDiscovery('service'), getAllDiscovery('experience')]);
    return { services: sortCatalog(services as Service[]), experiences: sortCatalog(experiences as Experience[]) };
  }, { services: [] as Service[], experiences: [] as Experience[] });
  const search = async (value = input) => {
    const generation = ++searchGeneration.current;
    const text = value.trim();
    setInput(text); setQuery(text); setLimit(30);
    if (!text) return;
    const next = [text, ...history.filter(item => item !== text)].slice(0, 12);
    setHistory(next); Taro.setStorageSync('aiye.search.history', next);
    if (tab === 'user') {
      if (!requireLogin()) return;
      setUserBusy(true); setSearchedUser(true);
      try {
        const found = await request<User>(`/users/search?query=${encodeURIComponent(text)}`);
        if (generation === searchGeneration.current) setUser(found);
      } catch (error) { if (generation === searchGeneration.current) { setUser(null); showError(error); } }
      finally { if (generation === searchGeneration.current) setUserBusy(false); }
    }
  };
  const filtered = (tab === 'service' ? resource.data.services : resource.data.experiences)
    .filter(item => `${item.title} ${item.description} ${item.location} ${item.category}`.toLowerCase().includes(query.toLowerCase()));
  return <View className={styles.page}>
    <View className={styles.search}><Input focus className={styles.input} value={input} placeholder={tab === 'user' ? '手机号或爱野 ID' : '搜索标题、地点、分类'}
      confirmType="search" onInput={event => setInput(event.detail.value)} onConfirm={() => void search()} />
      <ActionButton small onClick={() => void search()}>搜索</ActionButton></View>
    <ScrollView className={styles.tabs} scrollX><View className={styles.tabRow}>
      {[['experience', '体验'], ['service', '服务'], ['user', '用户']].map(([key, name]) =>
        <View key={key} className={classnames(styles.tab, tab === key && styles.active)} onClick={() => {
          searchGeneration.current++; setTab(key); setQuery(''); setInput(''); setUser(null); setUserBusy(false); setSearchedUser(false);
        }}>{name}</View>)}
    </View></ScrollView>
    {!query && !!history.length && <View className={styles.section}><View className={styles.header}>
      <Text className={styles.heading}>搜索历史</Text><Text className={styles.link} onClick={() => { setHistory([]); Taro.removeStorageSync('aiye.search.history'); }}>清空</Text>
    </View><Tags values={history} onToggle={value => void search(value)} /></View>}
    {query && (tab === 'user' ? <>
      <StateView loading={userBusy} empty={searchedUser && !user} title="未找到用户" />
      {user && <View className={styles.row} onClick={() => Taro.navigateTo({ url: `/pages/profile/index?id=${encodeURIComponent(user.id)}` })}>
        <Avatar url={user.photo_url} name={user.name} /><View className={styles.rowBody}><Text className={styles.rowTitle}>{user.name}</Text>
          <Text className={styles.rowMeta}>{user.pei_pei_id} · {user.region}</Text></View><Text>›</Text></View>}
    </> : <>
      <StateView loading={resource.loading} error={resource.error} empty={!filtered.length} title="没有匹配的内容" onRetry={resource.error ? resource.refresh : undefined} />
      {filtered.slice(0, limit).map(item => <ItemCard key={item.id} item={item} kind={tab === 'service' ? 'service' : 'experience'} row />)}
      {filtered.length > limit && <Text className={styles.link} onClick={() => setLimit(value => value + 30)}>加载更多</Text>}
    </>)}
  </View>;
}
