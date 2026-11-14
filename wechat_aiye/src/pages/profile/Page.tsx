import React, { useState } from 'react';
import Taro, { useDidShow, useShareAppMessage } from '@tarojs/taro';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { createConversation, getAllDiscovery, mediaUrl, request, showError } from '@/services/api';
import { requireLogin, useSession } from '@/store/session';
import { useResource } from '@/hooks/useResource';
import { ActionButton, Avatar, MenuRow, StateView, Tags } from '@/components/UI';
import ItemCard from '@/components/ItemCard';
import type { Experience, Service, User } from '@/types/models';
import styles from '@/styles/page.module.scss';

export default function ProfilePage() {
  const params = Taro.getCurrentInstance().router?.params || {};
  const session = useSession();
  const id = params.id || session.user?.id || '';
  const [tab, setTab] = useState(params.section === 'reviews' ? '评价' : '资料');
  const [busy, setBusy] = useState(false);
  const resource = useResource(async () => {
    if (!id) throw new Error('未找到用户');
    const [user, services, experiences] = await Promise.all([
      request<User>(`/users/${encodeURIComponent(id)}`), getAllDiscovery('service'), getAllDiscovery('experience'),
    ]);
    return { user, services: (services as Service[]).filter(item => item.creator_id === id),
      experiences: (experiences as Experience[]).filter(item => item.host_id === id) };
  }, { user: null as User | null, services: [] as Service[], experiences: [] as Experience[] }, id);
  useDidShow(() => { void resource.refresh(); });
  const user = resource.data.user;
  const self = id === session.user?.id;
  const photos = [...new Set([user?.photo_url, ...(user?.profile_image_urls || [])].filter((value): value is string => !!value))];
  useShareAppMessage(() => ({ title: `${user?.name || '用户'}的爱野主页`, path: `/pages/profile/index?id=${encodeURIComponent(id)}`, imageUrl: mediaUrl(user?.photo_url) }));
  const contact = async () => {
    if (busy || !requireLogin()) return;
    setBusy(true);
    try {
      const result = await createConversation(id);
      void Taro.navigateTo({ url: `/pages/thread/index?id=${encodeURIComponent(result.conversation.id)}&peer=${encodeURIComponent(id)}` });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  if (!user) return <StateView loading={resource.loading} error={resource.error} onRetry={resource.refresh} />;
  return <View className={styles.page}>
    <View className={styles.header}><Avatar url={user.photo_url} name={user.name} size={128} />
      <View className={styles.rowBody}><Text className={styles.title}>{user.name}</Text><Text className={styles.rowMeta}>{user.region}</Text>
        {user.identity_verified && <Text className={styles.badge}>身份已认证</Text>}</View></View>
    <View className={styles.actions}><View><ActionButton outline loading={busy} onClick={() => self
      ? Taro.navigateTo({ url: '/pages/profile-edit/index' }) : void contact()}>{self ? '编辑资料' : '聊一聊'}</ActionButton></View>
      <View><ActionButton outline openType="share">分享主页</ActionButton></View></View>
    <View className={styles.section}><ScrollView className={styles.tabs} scrollX><View className={styles.tabRow}>
      {['资料', '照片', '服务', '体验', '评价'].map(name => <View key={name} className={classnames(styles.tab, tab === name && styles.active)} onClick={() => setTab(name)}>{name}</View>)}
    </View></ScrollView></View>
    {tab === '资料' && <>
      <Text className={styles.text}>{user.signature || '暂无自我介绍'}</Text>
      <View className={styles.section}><Tags values={user.tags || []} /></View>
      <MenuRow label="爱野 ID" value={user.pei_pei_id || '未设置'} arrow={false} />
      <MenuRow label="性别" value={user.gender || '未设置'} arrow={false} />
      <MenuRow label="地区" value={user.region || '未设置'} arrow={false} />
      <MenuRow label="职业" value={user.job_title || '未设置'} arrow={false} />
      <MenuRow label="教育背景" value={user.education || '未设置'} arrow={false} />
      <MenuRow label="出生年代" value={user.birth_decade || '未设置'} arrow={false} />
      <MenuRow label="身高体重" value={user.height_weight_private && !self ? '已隐藏'
        : [user.height_cm ? `${user.height_cm}cm` : '', user.weight_kg ? `${user.weight_kg}kg` : ''].filter(Boolean).join(' · ') || '未设置'} arrow={false} />
      <MenuRow label="语言" value={user.spoken_languages?.join('、') || '未设置'} arrow={false} />
      <MenuRow label="常住城市" value={[user.living_country, user.living_city].filter(Boolean).join(' · ') || '未设置'} arrow={false} />
      <MenuRow label="中学最喜欢的歌" value={user.middle_school_favorite_song || '未设置'} arrow={false} />
    </>}
    {tab === '照片' && <View className={styles.photos}>{photos.map(url => <Image key={url} src={mediaUrl(url)} mode="aspectFill" className={styles.photo}
      onError={() => console.error('[Profile] Image failed', id)}
      onClick={() => Taro.previewImage({ current: mediaUrl(url), urls: photos.map(mediaUrl) })} />)}
      {!photos.length && <StateView empty title="暂无照片" />}</View>}
    {tab === '服务' && <><StateView empty={!resource.data.services.length} title="暂无已发布服务" />
      {resource.data.services.map(item => <ItemCard key={item.id} item={item} kind="service" row />)}</>}
    {tab === '体验' && <><StateView empty={!resource.data.experiences.length} title="暂无已发布体验" />
      {resource.data.experiences.map(item => <ItemCard key={item.id} item={item} kind="experience" row />)}</>}
    {tab === '评价' && <><Text className={styles.heading}>{user.review_count || 0}条评价{user.average_rating > 0 ? ` · ★ ${user.average_rating.toFixed(2)}分` : ''}</Text>
      {user.review_summaries?.length ? user.review_summaries.map((review, index) => <View key={index} className={styles.section}><Text className={styles.text}>{review}</Text></View>)
        : <StateView empty title="暂无评价" />}</>}
  </View>;
}
