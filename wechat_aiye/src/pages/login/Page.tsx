import React, { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Checkbox, Input, Text, View } from '@tarojs/components';
import { login, loginWithPhone, loginWithWeChat, request, sendPhoneCode, showError } from '@/services/api';
import { uniqueId } from '@/utils/catalog';
import { ActionButton } from '@/components/UI';
import { finishAccountFlow, getSessionGeneration } from '@/store/session';
import styles from '@/styles/page.module.scss';

export default function LoginPage() {
  const operation = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sms, setSms] = useState(false);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const sendCode = async () => {
    if (operation.current || cooldown) return;
    if (!/^1[3-9]\d{9}$/.test(phone)) { void Taro.showToast({ title: '请输入正确的手机号', icon: 'none' }); return; }
    operation.current = true; setBusy(true);
    const generation = getSessionGeneration();
    try {
      const result = await sendPhoneCode(phone, registering ? 'register' : 'login');
      if (mounted.current && getSessionGeneration() === generation) setCooldown(result.cooldown_seconds || 60);
    } catch (error) { if (mounted.current && getSessionGeneration() === generation) showError(error); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };
  const submit = async () => {
    if (operation.current) return;
    if (!/^1[3-9]\d{9}$/.test(phone)) { void Taro.showToast({ title: '请输入正确的手机号', icon: 'none' }); return; }
    if ((!sms || registering) && (!password || (registering && password.length < 6))) { void Taro.showToast({ title: registering ? '密码至少6位' : '请输入密码', icon: 'none' }); return; }
    if ((!sms || registering) && encodeURIComponent(password).replace(/%[A-F\d]{2}/gi, '_').length > 72) {
      void Taro.showToast({ title: '密码最多72字节，请缩短密码', icon: 'none' }); return;
    }
    if ((sms || registering) && !/^\d{6}$/.test(code)) { void Taro.showToast({ title: '请输入6位验证码', icon: 'none' }); return; }
    if (!agreed) { void Taro.showToast({ title: '请确认账号使用说明', icon: 'none' }); return; }
    if (registering && !name.trim()) { void Taro.showToast({ title: '请输入姓名或昵称', icon: 'none' }); return; }
    operation.current = true; setBusy(true);
    const generation = getSessionGeneration();
    try {
      if (registering) {
        const now = Date.now();
        await request('/users/register', 'POST', { id: uniqueId(), password, phone_number: phone,
          verify_code: code, name: name.trim(), pei_pei_id: '', photo_url: '', is_profile_completed: false, created_at: now, updated_at: now });
      }
      if (sms && !registering) {
        const result = await loginWithPhone(phone, code);
        if (mounted.current) await finishAccountFlow(result.user, generation + 1, result.need_bind_phone);
      } else {
        const user = await login(phone, password);
        if (mounted.current) await finishAccountFlow(user, generation + 1);
      }
    } catch (error) { if (mounted.current) showError(error); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };
  return <View className={styles.page}>
    <View className={styles.section}><Text className={styles.title}>{registering ? '注册爱野' : '登录爱野'}</Text></View>
    <View className={styles.section}>
      {registering && <View className={styles.field}><Text className={styles.label}>姓名或昵称</Text>
        <Input className={styles.input} value={name} maxlength={30} placeholder="怎么称呼你" onInput={event => setName(event.detail.value)} /></View>}
      <View className={styles.field}><Text className={styles.label}>手机号</Text>
        <Input className={styles.input} type="number" maxlength={11} value={phone} placeholder="请输入手机号" onInput={event => setPhone(event.detail.value)} /></View>
      {(sms || registering) && <View className={styles.field}><Text className={styles.label}>验证码</Text>
        <View className={styles.search}><Input className={styles.input} type="number" maxlength={6} value={code} placeholder="6位短信验证码"
          onInput={event => setCode(event.detail.value)} /><ActionButton small outline disabled={busy || cooldown > 0}
          onClick={() => void sendCode()}>{cooldown ? `${cooldown}秒` : '获取验证码'}</ActionButton></View></View>}
      {(!sms || registering) && <View className={styles.field}><Text className={styles.label}>密码</Text>
        <Input className={styles.input} password maxlength={128} value={password} placeholder={registering ? '至少6位密码' : '请输入密码'}
          onInput={event => setPassword(event.detail.value)} onConfirm={() => void submit()} /></View>}
      <View className={styles.row} onClick={() => setAgreed(value => !value)}>
        <Checkbox value="agreed" checked={agreed} color="#E0115F" /><Text className={styles.muted}>我确认使用本人账号，不发布违法或虚假内容。</Text>
      </View>
      <View className={styles.actions}><View><ActionButton loading={busy} onClick={() => void submit()}>{registering ? '注册并登录' : '登录'}</ActionButton></View></View>
      {!registering && <Text className={styles.link} onClick={() => { if (operation.current) return; setSms(value => !value); setCode(''); }}>{sms ? '使用密码登录' : '使用短信验证码登录'}</Text>}
      {process.env.TARO_ENV === 'weapp' && <ActionButton outline loading={busy} onClick={async () => {
        if (operation.current) return;
        if (!agreed) { void Taro.showToast({ title: '请确认账号使用说明', icon: 'none' }); return; }
        operation.current = true; setBusy(true);
        const generation = getSessionGeneration();
        try {
          const result = await loginWithWeChat();
          if (mounted.current) await finishAccountFlow(result.user, generation + 1, result.need_bind_phone);
        } catch (error) { if (mounted.current) showError(error); }
        finally { operation.current = false; if (mounted.current) setBusy(false); }
      }}>微信快捷登录</ActionButton>}
      <Text className={styles.link} onClick={() => { if (operation.current) return; setRegistering(value => !value); setPassword(''); setCode(''); }}>
        {registering ? '已有账号，去登录' : '没有账号，去注册'}
      </Text>
    </View>
  </View>;
}
