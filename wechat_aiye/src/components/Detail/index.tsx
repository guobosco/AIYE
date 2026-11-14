import React, { useEffect, useMemo, useState } from 'react';
import Taro, { useDidShow, useShareAppMessage } from '@tarojs/taro';
import { Button, Image, ScrollView, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { createConversation, getExperienceFavorites, getItem, getWishlist, mediaUrl, request, showError, toggleFavorite } from '@/services/api';
import { requireLogin, useSession } from '@/store/session';
import { getClosures, recordView } from '@/store/activity';
import { useResource } from '@/hooks/useResource';
import { ActionButton, Avatar, StateView, Tags } from '@/components/UI';
import { DECLARATIONS, homeMeta, hostOf, itemUrl } from '@/utils/catalog';
import { bookingDays, scheduledMillis } from '@/utils/booking';
import { decodePriceTiers, priceBasisLabel } from '@/utils/pricing';
import type { Experience, ItemKind, Service, User } from '@/types/models';
import styles from './index.module.scss';

export default function Detail({ kind }: { kind: ItemKind }) {
  const id = Taro.getCurrentInstance().router?.params?.id || '';
  const session = useSession();
  const [hostUser, setHostUser] = useState<User | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [plan, setPlan] = useState(0);
  const resource = useResource(async () => {
    if (!id) throw new Error('未找到内容');
    const item = await getItem(kind, id);
    recordView(item, kind);
    return item;
  }, null as Service | Experience | null, `${kind}.${id}.${session.user?.id || 'guest'}`);
  const item = resource.data;
  const host = item ? hostOf(item, kind) : { id: '', name: '' };
  const service = item as Service | null;
  const experience = item as Experience | null;
  const images = useMemo(() => [...new Set([item?.cover_image_url, ...(item?.image_urls || [])].filter((value): value is string => !!value))].map(mediaUrl), [item]);
  const tiers = useMemo(() => item ? decodePriceTiers(item.price_text, item.price_basis_text) : [], [item]);
  const days = useMemo(() => item ? bookingDays(kind === 'service' ? item as Service : {
    booking_time_ranges_json: '', booking_lead_hours: 0, booking_future_open_days: 30,
  }, new Date(), host.id === session.user?.id ? getClosures(id) : {}) : [], [item, kind, sheet, host.id, session.user?.id, id]);
  const day = days.find(value => value.key === date) || days[0];
  const selectedTime = day?.times.includes(time) ? time : day?.times[0] || '';
  const isOwner = !!host.id && host.id === session.user?.id;
  useShareAppMessage(() => ({ title: item?.title || '爱野', path: itemUrl(kind, id), imageUrl: images[0] }));
  useEffect(() => {
    if (!host.id) return;
    let active = true;
    void request<User>(`/users/${encodeURIComponent(host.id)}`).then(user => { if (active) setHostUser(user); })
      .catch(() => console.error('[Detail] Host profile unavailable'));
    return () => { active = false; };
  }, [host.id]);
  useDidShow(() => {
    if (!session.token) { setFavorite(false); return; }
    void (kind === 'service' ? getWishlist().then(profile => profile.service_ids) : getExperienceFavorites())
      .then(ids => setFavorite(ids.includes(id))).catch(showError);
  });
  const toggle = async () => {
    if (busy || !requireLogin()) return;
    setBusy(true);
    try { setFavorite(await toggleFavorite(kind, id)); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  const chat = async () => {
    if (busy || !requireLogin() || !host.id || isOwner) return;
    setBusy(true);
    try {
      const conversation = await createConversation(host.id);
      void Taro.navigateTo({ url: `/pages/thread/index?id=${encodeURIComponent(conversation.conversation.id)}&peer=${encodeURIComponent(host.id)}&${kind}=${encodeURIComponent(id)}` });
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  if (!item) return <StateView loading={resource.loading} error={resource.error} onRetry={resource.refresh} />;
  return <View className={styles.page}>
    <View className={styles.hero}><Swiper className={styles.swiper} current={image} onChange={event => setImage(event.detail.current)}>
      {images.length ? images.map(url => <SwiperItem key={url}><Image className={styles.image} src={url} mode="aspectFill"
        onError={() => console.error('[Detail] Image failed', id)} onClick={() => Taro.previewImage({ current: url, urls: images })} /></SwiperItem>)
        : <SwiperItem><View className={styles.missing}>暂无图片</View></SwiperItem>}
    </Swiper><Text className={styles.pager}>{images.length ? `${image + 1} / ${images.length}` : '0 / 0'}</Text></View>
    <View className={styles.panel}>
      <Text className={styles.title}>{item.title}</Text>
      <Text className={styles.meta}>{homeMeta(item)}</Text>
      <Text className={styles.meta}>{kind === 'service' ? [item.category, service?.service_mode].filter(Boolean).join(' · ') : [item.category, experience?.duration_text].filter(Boolean).join(' · ')}</Text>
      <View className={styles.actions}><View><ActionButton outline loading={busy} onClick={() => void toggle()}>{favorite ? '已收藏' : '加入心愿单'}</ActionButton></View>
        <View><Button openType="share" className={styles.share}>分享</Button></View></View>
      <View className={styles.host}>
        <View onClick={() => host.id && Taro.navigateTo({ url: `/pages/profile/index?id=${encodeURIComponent(host.id)}` })}>
          <Avatar url={hostUser?.photo_url} name={hostUser?.name || host.name} />
        </View>
        <View className={styles.hostInfo} onClick={() => host.id && Taro.navigateTo({ url: `/pages/profile/index?id=${encodeURIComponent(host.id)}` })}>
          <Text className={styles.hostName}>{hostUser?.name || host.name || '主理人'}</Text>
          <Text className={styles.meta}>{hostUser ? [hostUser.identity_verified ? '身份已认证' : '', `${hostUser.review_count || 0}条评价`, `${hostUser.service_years || 0}年服务经验`].filter(Boolean).join(' · ') : '查看个人主页'}</Text>
        </View>
        {!isOwner && host.id && <ActionButton small outline loading={busy} onClick={() => void chat()}>聊一聊</ActionButton>}
      </View>
      <View className={styles.section}><Text className={styles.heading}>{kind === 'service' ? '服务介绍' : '体验介绍'}</Text><Text className={styles.text}>{item.description || '暂无介绍'}</Text></View>
      {kind === 'experience' && !!experience?.detail_steps?.length && <View className={styles.section}><Text className={styles.heading}>体验行程</Text>
        {experience.detail_steps.map((step, index) => <View key={index} className={styles.step}><Text className={styles.heading}>{index + 1}. {step.title}</Text>
          <Text className={styles.text}>{step.description}</Text>
          {step.image_urls.map(url => <Image key={url} src={mediaUrl(url)} mode="aspectFill" className={styles.stepImage}
            onError={() => console.error('[Detail] Step image failed', id)} onClick={() => Taro.previewImage({ current: mediaUrl(url), urls: step.image_urls.map(mediaUrl) })} />)}
        </View>)}</View>}
      <View className={styles.section}><Text className={styles.heading}>{kind === 'service' ? '服务特点' : '体验标签'}</Text>
        <Tags values={kind === 'service' ? service?.service_feature_tags || [] : experience?.tags || []} /></View>
      <View className={styles.section}><Text className={styles.heading}>价格与费用</Text>
        {kind === 'service' ? tiers.map((value, index) => <View key={index} className={styles.plan}><Text className={styles.hostName}>{value.name || `档位${index + 1}`}</Text>
          <Text className={styles.meta}>{value.price} · {value.duration_amount}{value.duration_unit}</Text></View>)
          : <Text className={styles.text}>{item.price_text} {priceBasisLabel(item.price_basis_text)}</Text>}
        {kind === 'service' && <><Text className={styles.meta}>预付款 {service?.prepayment_percent ?? 30}%</Text>
          <Text className={styles.meta}>提前 {service?.full_refund_cancel_lead_days ?? 1} 天取消可全额退还预付款</Text>
          {!!service?.service_extra_fee_tags?.length && <Tags values={service.service_extra_fee_tags} />}</>}
      </View>
      <View className={styles.section}><Text className={styles.heading}>预定须知</Text>
        {kind === 'service' && <Text className={styles.meta}>至少提前 {service?.booking_lead_hours || 0} 小时问询，开放未来 {service?.booking_future_open_days || 30} 天。</Text>}
        {[...DECLARATIONS, ...(kind === 'service' ? service?.service_declarations_extra || [] : [])].map((line, index) =>
          <Text key={line} className={styles.meta}>{index + 1}. {line}</Text>)}
      </View>
      {hostUser && <View className={styles.section}><Text className={styles.heading}>{hostUser.review_count || 0}条评价</Text>
        {hostUser.review_summaries?.map((review, index) => <Text key={index} className={styles.meta}>{review}</Text>)}
      </View>}
      <View className={styles.spacer} />
    </View>
    <View className={styles.bottom}><View className={styles.bottomPrice}>{item.price_text?.match(/[¥￥]\s*\d+/)?.[0] || '价格面议'}</View>
      {isOwner ? <ActionButton outline onClick={() => Taro.navigateTo({ url: `/pages/publish/index?kind=${kind}&id=${encodeURIComponent(id)}` })}>编辑</ActionButton>
        : <ActionButton disabled={!host.id} onClick={() => { if (requireLogin()) setSheet(true); }}>选择时间</ActionButton>}
    </View>
    {sheet && <View className={styles.mask} onClick={() => setSheet(false)}><View className={styles.sheet} onClick={event => event.stopPropagation()}>
      <View className={styles.sheetHeader}><Text className={styles.heading}>预定问询</Text><Text className={styles.close} onClick={() => setSheet(false)}>×</Text></View>
      <ScrollView scrollY className={styles.scroll}>
        {kind === 'service' && tiers.map((value, index) => <View key={index} className={classnames(styles.plan, plan === index && styles.selected)} onClick={() => setPlan(index)}>
          <Text className={styles.hostName}>{value.name || `档位${index + 1}`}</Text><Text className={styles.meta}>{value.price} · {value.duration_amount}{value.duration_unit}</Text>
        </View>)}
        <ScrollView scrollX className={styles.dates}>{days.map(value => <View key={value.key} className={classnames(styles.date, day?.key === value.key && styles.selected)}
          onClick={() => { setDate(value.key); setTime(''); }}>{value.label}</View>)}</ScrollView>
        <View className={styles.times}>{day?.times.map(value => <View key={value} className={classnames(styles.time, selectedTime === value && styles.selected)}
          onClick={() => setTime(value)}>{value}</View>)}</View>
        {!days.length && <Text className={styles.meta}>当前暂无可选时间，请联系主理人。</Text>}
      </ScrollView>
      <ActionButton disabled={!day || !selectedTime} onClick={() => {
        if (!day || !selectedTime) return;
        const scheduled = scheduledMillis(day.key, selectedTime);
        setSheet(false);
        void Taro.navigateTo({ url: `/pages/payment/index?kind=${kind}&id=${encodeURIComponent(id)}&scheduled=${scheduled}&plan=${plan}` });
      }}>确认问询信息</ActionButton>
    </View></View>}
  </View>;
}
