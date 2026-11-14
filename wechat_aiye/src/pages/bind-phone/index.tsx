import React, { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Input, Text, View } from '@tarojs/components';
import { request, sendPhoneCode, showError } from '@/services/api';
import { finishAccountFlow, getSession, getSessionGeneration, requireSession, updateSessionUser, useSession } from '@/store/session';
import { ActionButton, StateView } from '@/components/UI';
import type { User } from '@/types/models';
import styles from './index.module.scss';

export default function BindPhonePage() {
  const session = useSession();
  const generation = getSessionGeneration();
  const operation = useRef<{ generation: number } | null>(null);
  const mounted = useRef(true);
  const [formGeneration, setFormGeneration] = useState(generation);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current = null; };
  }, []);
  useEffect(() => {
    operation.current = null; setBusy(false);
    setPhone(''); setCode(''); setCooldown(0); setFormGeneration(generation);
  }, [generation]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const validPhone = () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) { void Taro.showToast({ title: '请输入正确手机号', icon: 'none' }); return false; }
    return requireSession();
  };
  const current = (task: { generation: number }) => mounted.current && operation.current === task
    && getSessionGeneration() === task.generation;
  const finishOperation = (task: { generation: number }) => {
    if (operation.current !== task) return;
    operation.current = null;
    if (mounted.current) setBusy(false);
  };
  if (!session.token) return <StateView onLogin={requireSession} />;
  if (formGeneration !== generation) return <StateView loading />;
  return <View className={styles.page}><View className={styles.header}><Text className={styles.title}>绑定手机号</Text></View>
    <View className={styles.field}><Text className={styles.label}>手机号</Text><Input className={styles.input} type="number" maxlength={11} value={phone}
      placeholder="请输入本人手机号" onInput={event => setPhone(event.detail.value)} /></View>
    <View className={styles.search}><Input className={styles.input} type="number" maxlength={6} value={code} placeholder="6位验证码"
      onInput={event => setCode(event.detail.value)} /><ActionButton small outline disabled={busy || cooldown > 0} onClick={async () => {
      if (operation.current || cooldown || !validPhone()) return;
      const task = { generation: getSessionGeneration() };
      operation.current = task; setBusy(true);
      try {
        const result = await sendPhoneCode(phone, 'bind_wechat_phone');
        if (current(task)) setCooldown(result.cooldown_seconds || 60);
      } catch (error) { if (current(task)) showError(error); }
      finally { finishOperation(task); }
    }}>{cooldown ? `${cooldown}秒` : '获取验证码'}</ActionButton></View>
    <ActionButton loading={busy} onClick={async () => {
      if (operation.current || !validPhone()) return;
      if (!/^\d{6}$/.test(code)) { void Taro.showToast({ title: '请输入6位验证码', icon: 'none' }); return; }
      const task = { generation: getSessionGeneration() };
      operation.current = task; setBusy(true);
      try {
        const user = await request<User>('/auth/wechat/bind-phone', 'POST', { phone_number: phone, verify_code: code });
        if (!current(task)) return;
        if (user.id !== getSession().user?.id) throw new Error('绑定结果与当前账号不一致，请重试');
        updateSessionUser(user);
        await finishAccountFlow(user, task.generation);
      } catch (error) { if (current(task)) showError(error); }
      finally { finishOperation(task); }
    }}>绑定并下一步</ActionButton>
  </View>;
}
