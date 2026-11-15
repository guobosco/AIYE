import React, { useState } from 'react';
import Taro, { useDidShow, useDidHide } from '@tarojs/taro';
import { Picker, Switch, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { getItem, getCalendar, saveCalendarDay, showError } from '@/services/api';
import { getSession, requireLogin } from '@/store/session';
import { usePageOperation } from '@/hooks/usePageOperation';
import { useResource } from '@/hooks/useResource';
import { ActionButton, StateView } from '@/components/UI';
import { dateKey } from '@/utils/booking';
import type { CalendarClosure, Service } from '@/types/models';
import styles from './index.module.scss';

export default function CalendarPage() {
  const id = Taro.getCurrentInstance().router?.params?.id || '';
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('22:00');
  const operation = usePageOperation(`calendar.${id}`);
  const resource = useResource(async () => {
    if (!requireLogin()) throw new Error('请先完成账号资料');
    const item = await getItem('service', id) as Service;
    if (item.creator_id !== getSession().user?.id) throw new Error('仅发布者可管理日历');
    const calendar = await getCalendar(id);
    return { item, days: calendar.days };
  }, null as { item: Service; days: Record<string, CalendarClosure> } | null);
  useDidShow(() => { void resource.refresh(); });
  useDidHide(operation.cancel);
  const days = resource.data?.days || {};
  const closures = Object.fromEntries(Object.entries(days).filter(([, value]) => value.active !== false));
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leading = (month.getDay() + 6) % 7;
  const choose = (key: string) => {
    if (operation.busy || resource.loading || resource.error) return;
    setSelected(key); setAllDay(closures[key]?.allDay ?? true);
    setStart(closures[key]?.start || '08:00'); setEnd(closures[key]?.end || '22:00');
  };
  const save = async (clear: boolean) => {
    if (!selected || !resource.data || !requireLogin()) return;
    if (!clear && !allDay && start >= end) { void Taro.showToast({ title: '结束时间应晚于开始时间', icon: 'none' }); return; }
    const task = operation.begin();
    if (!task) return;
    const day = selected;
    try {
      const saved = await saveCalendarDay(id, day, {
        allDay, start, end, active: !clear, version: days[day]?.version || 0,
      });
      if (!operation.isCurrent(task)) return;
      resource.setData(value => value ? { ...value, days: { ...value.days, [day]: saved } } : value);
      void Taro.showToast({ title: '已同步日历', icon: 'success' });
    } catch (error) {
      if (operation.isCurrent(task)) { showError(error); setSelected(''); void resource.refresh(); }
    } finally { operation.finish(task); }
  };
  if (!resource.data || resource.loading || resource.error) return <StateView loading={resource.loading} error={resource.error} onRetry={resource.refresh} />;
  return <View className={styles.page}>
    <Text className={styles.heading}>{resource.data.item.title}</Text>
    <View className={styles.notice}>日历规则同步到所有客户端；仅控制可订时间，不构成订单占位。</View>
    <View className={styles.header}><Text className={styles.link} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>上月</Text>
      <Text className={styles.heading}>{month.getFullYear()}年{month.getMonth() + 1}月</Text>
      <Text className={styles.link} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>下月</Text></View>
    <View className={styles.grid}>{['一', '二', '三', '四', '五', '六', '日'].map(day => <View className={styles.gridCell} key={day}>{day}</View>)}
      {Array.from({ length: leading }, (_, i) => <View key={`blank${i}`} className={styles.gridCell} />)}
      {Array.from({ length: count }, (_, index) => {
        const day = new Date(month.getFullYear(), month.getMonth(), index + 1);
        const key = dateKey(day);
        return <View key={key} className={classnames(styles.gridCell, closures[key] && styles.closed, selected === key && styles.active)}
          onClick={() => choose(key)}>{index + 1}</View>;
      })}
    </View>
    {selected && <View className={styles.section}><Text className={styles.heading}>{selected}</Text>
      <View className={styles.row}><Text className={styles.rowBody}>全天不可订</Text><Switch checked={allDay} color="#E0115F" onChange={event => setAllDay(event.detail.value)} /></View>
      {!allDay && <View className={styles.search}><Picker mode="time" value={start} onChange={event => setStart(event.detail.value)}><View className={styles.picker}>{start}</View></Picker>
        <Text>至</Text><Picker mode="time" value={end} onChange={event => setEnd(event.detail.value)}><View className={styles.picker}>{end}</View></Picker></View>}
      <View className={styles.actions}><View><ActionButton disabled={operation.busy} outline onClick={() => void save(true)}>恢复可订</ActionButton></View><View><ActionButton disabled={operation.busy} onClick={() => void save(false)}>保存规则</ActionButton></View></View>
    </View>}
  </View>;
}
