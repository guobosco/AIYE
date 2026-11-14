import React from 'react';
import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { useSession, requireLogin } from '@/store/session';
import { ActionButton, MenuRow, StateView } from '@/components/UI';
import styles from './index.module.scss';

export default function VerificationPage() {
  const { user } = useSession();
  return <View className={styles.page}><View className={styles.header}><Text className={styles.title}>身份认证</Text></View>
    {!user ? <StateView onLogin={requireLogin} /> : <>
      <MenuRow label="认证状态" value={user.identity_verified ? '已认证' : '未认证'} arrow={false} />
      <MenuRow label="手机验证" value={user.is_phone_verified ? '已验证' : '未验证'} arrow={false} />
      {!user.identity_verified && <View className={styles.notice}>当前尚未接入证件识别、活体检测与身份比对服务。请勿通过聊天或反馈提交身份证照片。</View>}
      <ActionButton outline onClick={() => Taro.navigateTo({ url: '/pages/settings/index' })}>联系平台</ActionButton>
    </>}
  </View>;
}
