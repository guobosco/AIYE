import React from 'react';
import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { getConversations } from '@/services/api';
import { getSession, requireLogin, useSession } from '@/store/session';
import { useResource } from '@/hooks/useResource';
import { ActionButton, Avatar, StateView } from '@/components/UI';
import type { ConversationItem } from '@/types/models';
import styles from './index.module.scss';

export default function OrdersPage() {
  const income = Taro.getCurrentInstance().router?.params?.mode === 'income';
  const session = useSession();
  const resource = useResource(() => getSession().token ? getConversations() : Promise.resolve([] as ConversationItem[]), [] as ConversationItem[]);
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>{income ? '我的收入' : '我的接单'}</Text></View>
    {!session.token ? <StateView onLogin={requireLogin} /> : <>
      <View className={styles.notice}>{income
        ? '当前未接入正式支付与结算接口，暂无可核验收入或提现余额。'
        : '当前会话是沟通记录，不是已确认订单。接单、履约和取消请与对方沟通确认。'}</View>
      {income ? <><Text className={styles.heading}>结算状态</Text><Text className={styles.number}>未开通</Text>
        <ActionButton outline onClick={() => Taro.switchTab({ url: '/pages/messages/index' })}>查看沟通记录</ActionButton></>
        : <><Text className={styles.heading}>沟通记录</Text><StateView loading={resource.loading} error={resource.error}
          empty={!resource.data.length} title="暂无沟通记录" onRetry={resource.error ? resource.refresh : undefined} />
          {resource.data.map(item => <View key={item.conversation.id} className={styles.row} onClick={() => Taro.navigateTo({
            url: `/pages/thread/index?id=${encodeURIComponent(item.conversation.id)}&peer=${encodeURIComponent(item.peer?.id || '')}`,
          })}><Avatar url={item.peer?.photo_url} name={item.peer?.name} /><View className={styles.rowBody}>
            <Text className={styles.rowTitle}>{item.peer?.name || item.conversation.title}</Text>
            <Text className={styles.rowMeta}>{item.conversation.last_message_preview}</Text></View><Text>›</Text></View>)}
        </>}
    </>}
  </View>;
}
