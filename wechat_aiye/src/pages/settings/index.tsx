import React, { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Input, Switch, Text, Textarea, View } from '@tarojs/components';
import { API_BASE, logoutRemote, request, showError } from '@/services/api';
import { requireLogin, useSession } from '@/store/session';
import { ActionButton, MenuRow } from '@/components/UI';
import styles from './index.module.scss';

export default function SettingsPage() {
  const session = useSession();
  const [permissions, setPermissions] = useState<Taro.AuthSetting>({});
  const [notifications, setNotifications] = useState(Taro.getStorageSync<boolean>('aiye.notifications') !== false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState('');
  const refreshPermissions = async () => {
    try { const value = await Taro.getSetting({}); setPermissions(value.authSetting); }
    catch (error) { console.error('[Settings] Permission query unavailable'); }
  };
  useEffect(() => { void refreshPermissions(); }, []);
  const openPermissions = async () => {
    try { await Taro.openSetting({}); await refreshPermissions(); }
    catch (error) { showError(error); }
  };
  const scan = async () => {
    try {
      const result = await Taro.scanCode({ onlyFromCamera: false });
      if (result.path && /^pages\/(profile|service-detail|experience-detail)\/index(?:\?|$)/.test(result.path)) {
        void Taro.navigateTo({ url: `/${result.path}` }); return;
      }
      if (result.result.startsWith('aiye://user/')) {
        void Taro.navigateTo({ url: `/pages/profile/index?id=${encodeURIComponent(result.result.slice(12))}` }); return;
      }
      await Taro.showModal({ title: '扫描结果', content: result.result.slice(0, 1000), showCancel: false });
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && 'errMsg' in err && String(err.errMsg).includes('cancel'))) showError(err);
    }
  };
  const submitFeedback = async () => {
    if (busy || !requireLogin()) return;
    if (!feedback.trim()) { void Taro.showToast({ title: '请填写反馈内容', icon: 'none' }); return; }
    setBusy(true);
    try {
      await request('/feedbacks', 'POST', { source: 'weapp', content: feedback.trim(), contact: contact.trim(), category: 'product' });
      setFeedback(''); void Taro.showToast({ title: '反馈已提交', icon: 'success' });
    } catch (err) { showError(err); } finally { setBusy(false); }
  };
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>设置</Text></View>
    <View className={styles.section}><Text className={styles.heading}>账号</Text>
      <MenuRow label={session.user ? session.user.name : '登录账号'} value={session.user?.pei_pei_id} onClick={() => session.user
        ? Taro.navigateTo({ url: '/pages/profile-edit/index' }) : requireLogin()} />
      <MenuRow label="身份认证" value={session.user?.identity_verified ? '已认证' : '未认证'} onClick={() => { if (requireLogin()) void Taro.navigateTo({ url: '/pages/verification/index' }); }} />
      {session.user && !session.user.is_phone_verified && <MenuRow label="绑定手机号" onClick={() => Taro.navigateTo({ url: '/pages/bind-phone/index' })} />}
      <MenuRow label="扫一扫" onClick={() => void scan()} />
      {session.user && <MenuRow label="我的名片" onClick={() => Taro.navigateTo({ url: `/pages/profile/index?id=${encodeURIComponent(session.user!.id)}` })} />}
    </View>
    <View className={styles.section}><Text className={styles.heading}>权限设置</Text>
      <MenuRow label="位置权限" value={permissions['scope.userLocation'] ? '已允许' : '未允许'} onClick={() => void openPermissions()} />
      <MenuRow label="相册权限" value={permissions['scope.writePhotosAlbum'] ? '已允许' : '未允许'} onClick={() => void openPermissions()} />
      <View className={styles.row}><Text className={styles.rowBody}>消息提醒偏好</Text><Switch checked={notifications} color="#E0115F"
        onChange={event => { setNotifications(event.detail.value); Taro.setStorageSync('aiye.notifications', event.detail.value); }} /></View>
      <Text className={styles.muted}>微信系统通知与订阅消息以平台授权为准。</Text>
    </View>
    <View className={styles.section}><Text className={styles.heading}>意见反馈</Text>
      <Textarea className={styles.textarea} value={feedback} maxlength={2000} placeholder="描述遇到的问题或建议" onInput={event => setFeedback(event.detail.value)} />
      <Input className={styles.input} value={contact} placeholder="联系方式（选填）" onInput={event => setContact(event.detail.value)} />
      <View className={styles.actions}><View><ActionButton outline loading={busy} onClick={() => void submitFeedback()}>提交反馈</ActionButton></View></View>
    </View>
    <View className={styles.section}><Text className={styles.heading}>连接信息</Text><Text className={styles.muted}>{API_BASE}</Text>
      <MenuRow label="检测服务器" onClick={async () => {
        try { await request('/healthz'); void Taro.showToast({ title: '服务器连接正常', icon: 'success' }); }
        catch (err) { showError(err); }
      }} />
      <MenuRow label="清除搜索与浏览记录" onClick={async () => {
        const result = await Taro.showModal({ title: '清除本机记录', content: '不会删除服务器资料、收藏或聊天。' });
        if (!result.confirm) return;
        Taro.removeStorageSync('aiye.search.history');
        Taro.removeStorageSync(`aiye.viewed.${session.user?.id || 'guest'}`);
        void Taro.showToast({ title: '已清除', icon: 'success' });
      }} />
    </View>
    {session.token && <ActionButton outline onClick={async () => {
      const result = await Taro.showModal({ title: '退出登录', content: '是否退出当前账号？' });
      if (result.confirm) {
        try { await logoutRemote(); } catch (error) { showError(error); }
        void Taro.switchTab({ url: '/pages/mine/index' });
      }
    }}>退出登录</ActionButton>}
  </View>;
}
