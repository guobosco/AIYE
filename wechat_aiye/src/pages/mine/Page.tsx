import React from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { request, showError } from '@/services/api';
import { requireLogin, updateSessionUser, useSession } from '@/store/session';
import { ActionButton, Avatar, MenuRow } from '@/components/UI';
import type { User } from '@/types/models';
import styles from '@/styles/page.module.scss';

export default function MinePage() {
  const { user, token } = useSession();
  useDidShow(() => {
    if (token) void request<User>('/auth/me').then(updateSessionUser).catch(showError);
  });
  const open = (url: string) => { if (requireLogin()) void Taro.navigateTo({ url }); };
  return <View className={`${styles.page} ${styles.cream}`}>
    <View className={styles.header}><Text className={styles.title}>个人资料</Text><Text className={styles.link}
      onClick={() => Taro.navigateTo({ url: '/pages/settings/index' })}>设置</Text></View>
    <View className={styles.surface} onClick={() => user ? open(`/pages/profile/index?id=${encodeURIComponent(user.id)}`) : requireLogin()}>
      <View className={styles.row}><Avatar url={user?.photo_url} name={user?.name} size={128} />
        <View className={styles.rowBody}><Text className={styles.title}>{user?.name || '未登录'}</Text>
          <Text className={styles.rowMeta}>{user ? user.region || '未设置地区' : '点击登录'}</Text>
          {user?.identity_verified && <Text className={styles.badge}>身份已认证</Text>}
        </View><Text className={styles.muted}>›</Text>
      </View>
      <MenuRow label="爱野 ID" value={user?.pei_pei_id || '未设置'} arrow={false} />
      <MenuRow label="性别" value={user?.gender || '未设置'} arrow={false} />
      <MenuRow label="加入爱野" value={user ? `${new Date(user.created_at).getFullYear()}年` : '未登录'} arrow={false} />
      {user && <Text className={styles.link} onClick={event => {
        event.stopPropagation(); open('/pages/profile-edit/index');
      }}>编辑资料</Text>}
    </View>
    <View className={styles.surface}>
      <MenuRow label="我预定的" onClick={() => open('/pages/activity/index?type=booked')} />
      <MenuRow label="我浏览的" onClick={() => Taro.navigateTo({ url: '/pages/activity/index?type=viewed' })} />
    </View>
    <View className={styles.surface}>
      <MenuRow label="我发布的" onClick={() => open('/pages/published/index')} />
      <MenuRow label="我的接单" onClick={() => open('/pages/orders/index')} />
      <MenuRow label="我的收入" onClick={() => open('/pages/orders/index?mode=income')} />
      <MenuRow label="评价我的" value={user ? `${user.review_count || 0}条` : ''} onClick={() => user ? open(`/pages/profile/index?id=${encodeURIComponent(user.id)}&section=reviews`) : requireLogin()} />
    </View>
    <View className={styles.surface}>
      <MenuRow label="权限设置" onClick={() => Taro.navigateTo({ url: '/pages/settings/index?section=permissions' })} />
      <MenuRow label="身份认证" value={user?.identity_verified ? '已认证' : '未认证'} onClick={() => open('/pages/verification/index')} />
    </View>
    <ActionButton outline onClick={() => open('/pages/publish/index')}>发布服务或体验</ActionButton>
  </View>;
}
