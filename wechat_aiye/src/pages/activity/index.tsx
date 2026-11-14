import React, { useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import { getActivity, cancelBooking, clearActivity } from '@/store/activity';
import { mediaUrl } from '@/services/api';
import { requireLogin } from '@/store/session';
import { ActionButton, StateView } from '@/components/UI';
import { itemUrl } from '@/utils/catalog';
import type { ActivityRecord } from '@/types/models';
import styles from './index.module.scss';

export default function ActivityPage() {
  const type = Taro.getCurrentInstance().router?.params?.type === 'booked' ? 'booked' : 'viewed';
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  useDidShow(() => {
    if (type === 'booked' && !requireLogin()) return;
    setRecords(getActivity(type));
    void Taro.setNavigationBarTitle({ title: type === 'booked' ? '我预定的' : '我浏览的' });
  });
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>{type === 'booked' ? '我预定的' : '我浏览的'}</Text>
      {type === 'viewed' && !!records.length && <Text className={styles.link} onClick={async () => {
        const result = await Taro.showModal({ title: '清空浏览记录', content: '仅清空本机浏览记录。' });
        if (result.confirm) { clearActivity(type); setRecords([]); }
      }}>清空</Text>}
    </View>
    {type === 'booked' && <View className={styles.notice}>这里是本机保存的问询记录，不代表订单已确认或已支付。</View>}
    <StateView empty={!records.length} title={type === 'booked' ? '暂无问询记录' : '暂无浏览记录'} />
    {records.map(record => <View key={record.id} className={styles.section}>
      <View className={styles.row} onClick={() => Taro.navigateTo({ url: itemUrl(record.kind, record.item_id) })}>
        <Image src={mediaUrl(record.cover_image_url)} mode="aspectFill" className={styles.photo} onError={() => console.error('[Activity] Image failed')} />
        <View className={styles.rowBody}><Text className={styles.rowTitle}>{record.title}</Text>
          <Text className={styles.rowMeta}>{record.location}</Text><Text className={styles.rowMeta}>{record.price_text}</Text>
          <Text className={styles.rowMeta}>{new Date(record.scheduled_at || record.recorded_at).toLocaleString()}</Text></View>
      </View>
      {type === 'booked' && <><Text className={styles.badge}>{record.status === 'cancelled' ? '已标记取消' : '待沟通确认'}</Text>
        <View className={styles.actions}>
          <View><ActionButton small outline onClick={() => record.conversation_id && Taro.navigateTo({
            url: `/pages/thread/index?id=${encodeURIComponent(record.conversation_id)}&peer=${encodeURIComponent(record.host_id)}`,
          })}>联系主理人</ActionButton></View>
          {record.status !== 'cancelled' && <View><ActionButton small outline onClick={async () => {
            const result = await Taro.showModal({ title: '标记取消', content: '仅更新本机记录，请另行联系主理人确认取消。' });
            if (result.confirm) { cancelBooking(record.id); setRecords(getActivity(type)); }
          }}>标记取消</ActionButton></View>}
        </View></>}
    </View>)}
  </View>;
}
