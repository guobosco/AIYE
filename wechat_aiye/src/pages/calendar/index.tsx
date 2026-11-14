import React, { useState } from 'react';
import Taro from '@tarojs/taro';
import { Picker, Switch, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { getItem } from '@/services/api';
import { getSession } from '@/store/session';
import { getClosures, setClosures } from '@/store/activity';
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
  const [closures, setValue] = useState<Record<string, CalendarClosure>>(() => getClosures(id));
  const resource = useResource(async () => {
    const item = await getItem('service', id) as Service;
    if (item.creator_id !== getSession().user?.id) throw new Error('仅发布者可管理日历');
    return item;
  }, null as Service | null);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leading = (month.getDay() + 6) % 7;
  const choose = (key: string) => {
    setSelected(key); setAllDay(closures[key]?.allDay ?? true);
    setStart(closures[key]?.start || '08:00'); setEnd(closures[key]?.end || '22:00');
  };
  const save = (clear: boolean) => {
    if (!selected || !resource.data) return;
    if (!clear && !allDay && start >= end) { void Taro.showToast({ title: '结束时间应晚于开始时间', icon: 'none' }); return; }
    const next = { ...closures };
    if (clear) delete next[selected];
    else next[selected] = { allDay, start, end };
    setClosures(id, next); setValue(next);
    void Taro.showToast({ title: '已保存本机规则', icon: 'success' });
  };
  if (!resource.data) return <StateView loading={resource.loading} error={resource.error} onRetry={resource.refresh} />;
  return <View className={styles.page}>
    <Text className={styles.heading}>{resource.data.title}</Text>
    <View className={styles.notice}>日历规则保存在本机，当前不向其他用户同步，也不构成订单占位。</View>
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
      <View className={styles.actions}><View><ActionButton outline onClick={() => save(true)}>恢复可订</ActionButton></View><View><ActionButton onClick={() => save(false)}>保存规则</ActionButton></View></View>
    </View>}
  </View>;
}
