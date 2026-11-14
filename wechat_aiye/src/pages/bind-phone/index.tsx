import React, { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Input, Text, View } from '@tarojs/components';
import { request, sendPhoneCode, showError } from '@/services/api';
import { requireLogin, updateSessionUser } from '@/store/session';
import { ActionButton } from '@/components/UI';
import type { User } from '@/types/models';
import styles from './index.module.scss';

export default function BindPhonePage() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const validPhone = () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) { void Taro.showToast({ title: '请输入正确手机号', icon: 'none' }); return false; }
    return requireLogin();
  };
  return <View className={styles.page}><View className={styles.header}><Text className={styles.title}>绑定手机号</Text></View>
    <View className={styles.field}><Text className={styles.label}>手机号</Text><Input className={styles.input} type="number" maxlength={11} value={phone}
      placeholder="请输入本人手机号" onInput={event => setPhone(event.detail.value)} /></View>
    <View className={styles.search}><Input className={styles.input} type="number" maxlength={6} value={code} placeholder="6位验证码"
      onInput={event => setCode(event.detail.value)} /><ActionButton small outline disabled={busy || cooldown > 0} onClick={async () => {
      if (busy || cooldown || !validPhone()) return;
      setBusy(true);
      try { const result = await sendPhoneCode(phone, 'bind_wechat_phone'); setCooldown(result.cooldown_seconds || 60); }
      catch (error) { showError(error); } finally { setBusy(false); }
    }}>{cooldown ? `${cooldown}秒` : '获取验证码'}</ActionButton></View>
    <ActionButton loading={busy} onClick={async () => {
      if (!validPhone() || busy) return;
      if (!/^\d{6}$/.test(code)) { void Taro.showToast({ title: '请输入6位验证码', icon: 'none' }); return; }
      setBusy(true);
      try {
        const user = await request<User>('/auth/wechat/bind-phone', 'POST', { phone_number: phone, verify_code: code });
        updateSessionUser(user);
        void Taro.redirectTo({ url: user.is_profile_completed ? '/pages/profile/index' : '/pages/profile-edit/index' });
      } catch (error) { showError(error); } finally { setBusy(false); }
    }}>确认绑定</ActionButton>
  </View>;
}
