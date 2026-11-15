import React, { useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Input, Text, Textarea, View } from '@tarojs/components';
import { createConversation, getCalendar, getItem, sendMessage, showError } from '@/services/api';
import { requireLogin, useSession } from '@/store/session';
import { recordBooking } from '@/store/activity';
import { useResource } from '@/hooks/useResource';
import { ActionButton, MenuRow, StateView } from '@/components/UI';
import { displayLocation, hostOf, uniqueId } from '@/utils/catalog';
import { decodePriceTiers } from '@/utils/pricing';
import { bookingDays, dateKey } from '@/utils/booking';
import type { Experience, ItemKind, Service } from '@/types/models';
import styles from '@/styles/page.module.scss';

export default function PaymentPage() {
  const session = useSession();
  const params = Taro.getCurrentInstance().router?.params || {};
  const kind: ItemKind = params.kind === 'experience' ? 'experience' : 'service';
  const [guests, setGuests] = useState('1');
  const [location, setLocation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const pending = useRef<{ key: string; messageId: string } | null>(null);
  const resource = useResource(() => getItem(kind, params.id || ''), null as Service | Experience | null,
    `${kind}.${params.id || ''}.${session.user?.id || 'guest'}`);
  const item = resource.data;
  const planIndex = params.plan === undefined ? 0 : Number(params.plan);
  const plan = item && Number.isInteger(planIndex) && planIndex >= 0
    ? decodePriceTiers(item.price_text, item.price_basis_text)[planIndex] : null;
  const planName = plan?.name || `档位${planIndex + 1}`;
  const scheduled = Number(params.scheduled);
  const submit = async () => {
    if (submitting.current || !item || !requireLogin()) return;
    if (kind === 'service' && !plan) {
      void Taro.showToast({ title: '方案已变更，请返回详情重新选择', icon: 'none' }); return;
    }
    if (!Number.isFinite(scheduled) || scheduled < Date.now()) {
      void Taro.showToast({ title: '时间已失效，请重新选择', icon: 'none' }); return;
    }
    if (!/^\d+$/.test(guests) || Number(guests) < 1 || Number(guests) > 99) {
      void Taro.showToast({ title: '人数应为1至99人', icon: 'none' }); return;
    }
    const host = hostOf(item, kind);
    if (!host.id) return;
    submitting.current = true; setBusy(true);
    try {
      if (kind === 'service') {
        const freshItem = await getItem(kind, item.id) as Service;
        const calendar = await getCalendar(item.id);
        const selected = new Date(scheduled);
        const clock = `${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`;
        if (!bookingDays(freshItem, new Date(), calendar.days).some(day => day.key === dateKey(selected) && day.times.includes(clock))) {
          throw new Error('该时间已不可订，请返回详情重新选择');
        }
      }
      const conversation = await createConversation(host.id);
      const time = new Date(scheduled).toLocaleString();
      const content = [`你好，我想咨询“${item.title}”。`,
        kind === 'service' && plan ? `方案：${planName}，${plan.price}，${plan.duration_amount}${plan.duration_unit}` : '',
        `预期时间：${time}`, `人数：${guests}人`,
        `地点：${location.trim() || displayLocation(item.location) || '待沟通'}`, message.trim()].filter(Boolean).join('\n');
      const key = JSON.stringify([session.user?.id, conversation.conversation.id, kind, item.id, content, params.plan]);
      if (pending.current?.key !== key) pending.current = { key, messageId: uniqueId() };
      // A single card contains the full inquiry. Retrying uses the same server deduplication key.
      await sendMessage(conversation.conversation.id, {
        type: kind === 'service' ? 'service' : 'experience', content, client_message_id: pending.current.messageId,
        extra: { consultation: 'true', [`${kind}_id`]: item.id, title: item.title, description: item.description,
          price_text: kind === 'service' ? plan?.price || item.price_text : item.price_text,
          ...(kind === 'service' && plan ? { price_tier_name: planName, duration_amount: String(plan.duration_amount), duration_unit: plan.duration_unit } : {}),
          category: item.category, location: location.trim() || displayLocation(item.location), cover_image: item.cover_image_url,
          inquiry_date: `${dateKey(new Date(scheduled))} ${String(new Date(scheduled).getHours()).padStart(2, '0')}:${String(new Date(scheduled).getMinutes()).padStart(2, '0')}`,
          guest_count: guests, creator_id: host.id },
      });
      recordBooking(item, kind, scheduled, conversation.conversation.id, pending.current.messageId);
      void Taro.redirectTo({ url: `/pages/thread/index?id=${encodeURIComponent(conversation.conversation.id)}&peer=${encodeURIComponent(host.id)}&${kind}=${encodeURIComponent(item.id)}&inquiry_date=${encodeURIComponent(time)}` });
    } catch (error) { showError(error); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (!item) return <StateView loading={resource.loading} error={resource.error} onRetry={resource.refresh} />;
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>预定问询</Text></View>
    <View className={styles.section}>
      <MenuRow label={kind === 'service' ? '服务' : '体验'} value={item.title} arrow={false} />
      {kind === 'service' && plan && <MenuRow label="方案" value={`${planName} · ${plan.price} · ${plan.duration_amount}${plan.duration_unit}`} arrow={false} />}
      {kind === 'service' && !plan && <View className={styles.notice}>方案已变更，请返回详情重新选择。</View>}
      <MenuRow label="预期时间" value={Number.isFinite(scheduled) ? new Date(scheduled).toLocaleString() : '未选择'} arrow={false} />
      <MenuRow label="价格" value={item.price_text} arrow={false} />
    </View>
    <View className={styles.section}>
      <View className={styles.field}><Text className={styles.label}>人数</Text><Input className={styles.input} type="number" maxlength={2}
        value={guests} onInput={event => setGuests(event.detail.value)} /></View>
      <View className={styles.field}><Text className={styles.label}>地点</Text><Input className={styles.input} value={location}
        placeholder={displayLocation(item.location) || '与主理人沟通确认'} onInput={event => setLocation(event.detail.value)} /></View>
      <View className={styles.field}><Text className={styles.label}>补充说明</Text><Textarea className={styles.textarea} value={message}
        maxlength={1000} placeholder="说明你的安排或需求" onInput={event => setMessage(event.detail.value)} /></View>
    </View>
    <View className={styles.notice}>此操作发送问询并保存本机记录，尚未形成支付订单。价格、时间和履约安排需与主理人确认。</View>
    <ActionButton loading={busy} onClick={() => void submit()}>发送问询</ActionButton>
  </View>;
}
