import React, { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Input, Picker, ScrollView, Switch, Text, Textarea, View } from '@tarojs/components';
import { ActionButton, StateView } from '@/components/UI';
import { usePageOperation } from '@/hooks/usePageOperation';
import { getSessionGeneration, logout, requireSession, useSession } from '@/store/session';
import { sendPhoneCode } from '@/services/api';
import * as api from '@/services/consultation';
import styles from './index.module.scss';

const tabs = ['问询', '提醒', '会话', '屏蔽与举报', '账号', '搜索', '处理记录'];
const statusText = { pending: '待回复', replied: '已回复', closed: '已结束' };
const detailLabels: Record<string, string> = {
  inquiry_date: '意向日期', guest_count: '人数', selected_option: '方案',
  location: '地点', price_text: '参考价格', price_basis_text: '计价方式',
};
type Scene = 'change_phone_old' | 'change_phone_new' | 'close_account';

export default function ConsultationPage() {
  const session = useSession();
  const generation = getSessionGeneration();
  const [tab, setTab] = useState(0);
  const operation = usePageOperation(`consultation.${tab}`);
  const [error, setError] = useState('');
  const [inquiries, setInquiries] = useState<api.Inquiry[]>([]);
  const [notices, setNotices] = useState<api.Notice[]>([]);
  const [sessions, setSessions] = useState<api.LoginSession[]>([]);
  const [blocks, setBlocks] = useState<api.Block[]>([]);
  const [feedbacks, setFeedbacks] = useState<api.Feedback[]>([]);
  const [reminders, setReminders] = useState<api.Reminders | null>(null);
  const [results, setResults] = useState<api.SearchItem[]>([]);
  const [more, setMore] = useState(false);
  const [kind, setKind] = useState('experience');
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const [reportKind, setReportKind] = useState('user');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [phone, setPhone] = useState('');
  const [oldCode, setOldCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [closeCode, setCloseCode] = useState('');
  const [cooldowns, setCooldowns] = useState<Partial<Record<Scene, number>>>({});
  const [formGeneration, setFormGeneration] = useState(generation);
  useEffect(() => {
    setInquiries([]); setNotices([]); setSessions([]); setBlocks([]); setFeedbacks([]); setReminders(null); setResults([]);
    setTarget(''); setReason(''); setPhone(''); setOldCode(''); setNewCode(''); setCloseCode('');
    setCooldowns({}); setError(''); setMore(false); setFormGeneration(generation);
  }, [generation]);
  useEffect(() => {
    const timer = setInterval(() => setCooldowns(values => Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, Math.max(0, (value || 0) - 1)]),
    )), 1000);
    return () => clearInterval(timer);
  }, []);
  const run = async (work: () => Promise<void>, confirmation?: string) => {
    const task = operation.begin();
    if (!task) return;
    setError('');
    try {
      if (confirmation) {
        const result = await Taro.showModal({ title: '请确认', content: confirmation });
        if (!result.confirm || !operation.isCurrent(task)) return;
      }
      await work();
    } catch (err) {
      console.error('[Consultation] Operation failed');
      if (operation.isCurrent(task)) setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally { operation.finish(task); }
  };
  const loadData = async (append = false) => {
    const owner = generation;
    if (tab !== 5 && !session.token) return;
    if (tab === 0) {
      const page = await api.getInquiries(append ? inquiries.length : 0);
      if (getSessionGeneration() !== owner || !operation.active()) return;
      setInquiries(append ? [...inquiries, ...page] : page); setMore(page.length === 100);
    } else if (tab === 1) {
      const [page, preference] = await Promise.all([
        api.getNotices(append ? notices.length : 0), api.getReminders(),
      ]);
      if (getSessionGeneration() !== owner || !operation.active()) return;
      setNotices(append ? [...notices, ...page] : page); setReminders(preference); setMore(page.length === 100);
    } else if (tab === 2) {
      const page = await api.getSessions(append ? sessions.length : 0);
      if (getSessionGeneration() !== owner || !operation.active()) return;
      setSessions(append ? [...sessions, ...page] : page); setMore(page.length === 100);
    } else if (tab === 3) {
      const page = await api.getBlocks(append ? blocks.length : 0);
      if (getSessionGeneration() !== owner || !operation.active()) return;
      setBlocks(append ? [...blocks, ...page] : page); setMore(page.length === 100);
    } else if (tab === 5) {
      const page = await api.searchCatalog(kind, query, city, category, append ? results.length : 0);
      if (operation.active()) { setResults(append ? [...results, ...page] : page); setMore(page.length === 30); }
    } else if (tab === 6) {
      const page = await api.getFeedbacks(append ? feedbacks.length : 0);
      if (operation.active()) { setFeedbacks(append ? [...feedbacks, ...page] : page); setMore(page.length === 100); }
    }
  };
  useEffect(() => { void run(() => loadData()); }, [tab, generation]);
  const mutate = (path: string, method: 'POST' | 'PUT' | 'DELETE', body?: object, confirm?: string) =>
    run(async () => { await api.mutation(path, method, body); if (operation.active()) await loadData(); }, confirm);
  const thread = (id: string) => Taro.navigateTo({ url: `/pages/thread/index?id=${encodeURIComponent(id)}` });
  const input = (value: string, update: (value: string) => void, placeholder: string, numeric = false) =>
    <Input className={styles.input} value={value} disabled={operation.busy}
      type={numeric ? 'number' : 'text'} maxlength={numeric ? (placeholder.includes('手机号') ? 11 : 6) : 100}
      placeholder={placeholder} onInput={event => update(event.detail.value)} />;
  const sms = (scene: Scene) => <View className={styles.action}><ActionButton outline disabled={operation.busy || !!cooldowns[scene]}
    onClick={() => void run(async () => {
      const number = scene === 'change_phone_new' ? phone : session.user?.phone_number || '';
      if (!/^1[3-9]\d{9}$/.test(number)) throw new Error('请填写有效的已验证手机号');
      const result = await sendPhoneCode(number, scene);
      if (operation.active()) setCooldowns(values => ({ ...values, [scene]: result.cooldown_seconds || 60 }));
    })}>{cooldowns[scene] ? `${cooldowns[scene]}秒后重发` : scene === 'change_phone_new' ? '获取新号验证码' : scene === 'close_account' ? '获取注销验证码' : '获取旧号验证码'}</ActionButton></View>;
  const accountAction = (close: boolean) => run(async () => {
    if (!/^\d{6}$/.test(close ? closeCode : oldCode) || (!close && !/^\d{6}$/.test(newCode))) throw new Error('请填写6位验证码');
    if (!close && !/^1[3-9]\d{9}$/.test(phone)) throw new Error('请输入正确的新手机号');
    const response = await api.mutation(close ? '/auth/account/close' : '/auth/phone/change', 'POST',
      close ? { verify_code: closeCode, confirmation: '注销账号' } : { phone_number: phone, old_code: oldCode, new_code: newCode });
    if (close && response.closed !== true) throw new Error('注销结果未确认，请重新检查账号状态');
    if (!operation.active()) return;
    logout();
    await Taro.switchTab({ url: '/pages/mine/index' });
  }, close ? '注销将清除账号资料并下架发布内容，历史聊天保留匿名引用。此操作不可撤销。' : '换绑成功将退出全部登录会话，请使用新手机号重新登录。');

  if (formGeneration !== generation) return <StateView loading />;
  return <View className={styles.page}>
    <Text className={styles.title}>咨询中心</Text><Text className={styles.muted}>问询是咨询沟通记录，不是订单，不代表支付或档期预留。</Text>
    <ScrollView scrollX className={styles.tabs}>{tabs.map((label, index) => <View className={styles.tab} key={label}>
      <ActionButton outline={tab !== index} disabled={operation.busy} onClick={() => { setError(''); setMore(false); setTab(index); }}>{label}</ActionButton>
    </View>)}</ScrollView>
    <StateView loading={operation.busy} error={error} onRetry={() => void run(() => loadData())} />
    {tab !== 5 && !session.token ? <StateView onLogin={requireSession} /> : <>
      {tab === 0 && <>
        {!inquiries.length && !operation.busy && <StateView empty title="暂无问询" />}
        {inquiries.map(item => <View className={styles.card} key={item.id}>
          <Text className={styles.heading}>{item.title}</Text><Text>{statusText[item.status]}</Text>
          {Object.entries(detailLabels).filter(([key]) => item.details[key] != null && item.details[key] !== '').map(([key, label]) =>
            <Text className={styles.muted} key={key}>{label}：{String(item.details[key])}</Text>)}
          <View className={styles.action}><ActionButton outline disabled={operation.busy} onClick={() => void thread(item.conversation_id)}>查看沟通</ActionButton></View>
          {item.status !== 'closed' && <>
            {item.host_id === session.user?.id && item.status === 'pending' && <View className={styles.action}><ActionButton outline disabled={operation.busy}
              onClick={() => void mutate(`/me/inquiries/${encodeURIComponent(item.id)}`, 'PUT', { status: 'replied', version: item.version }, '标记为已回复？')}>标记已回复</ActionButton></View>}
            <View className={styles.action}><ActionButton outline disabled={operation.busy}
              onClick={() => void mutate(`/me/inquiries/${encodeURIComponent(item.id)}`, 'PUT', { status: 'closed', version: item.version }, '结束这条问询？结束后不能恢复。')}>结束问询</ActionButton></View>
          </>}
        </View>)}
      </>}
      {tab === 1 && <>
        <View className={styles.card}><View className={styles.row}><Text>站内提醒</Text><Switch checked={reminders?.enabled ?? true} color="#E0115F" disabled={operation.busy || !reminders}
          onChange={event => void mutate('/me/reminders', 'PUT', { enabled: event.detail.value })} /></View>
          <Text className={styles.muted}>偏好跨端同步。远程推送尚未配置，微信系统通知不等于站内提醒。</Text></View>
        {!notices.length && !operation.busy && <StateView empty title="暂无提醒" />}
        {notices.map(item => <View className={styles.card} key={item.id}><Text className={styles.heading}>{item.title}</Text>
          <Text className={styles.muted}>{item.is_read ? '已读' : '未读'}</Text>
          <ActionButton outline disabled={operation.busy} onClick={() => void run(async () => {
            await api.mutation(`/me/notices/${encodeURIComponent(item.id)}/read`);
            if (operation.active()) { await loadData(); if (item.conversation_id) await thread(item.conversation_id); }
          })}>查看提醒</ActionButton></View>)}
      </>}
      {tab === 2 && <>
        {!sessions.length && !operation.busy && <StateView empty title="暂无登录会话" />}
        {sessions.map(item => <View className={styles.card} key={item.id}>
        <Text className={styles.heading}>{item.is_current ? '当前会话' : '其他登录会话'}</Text>
        <Text className={styles.muted}>登录时间：{new Date(item.created_at).toLocaleString()}</Text>
        {!item.is_current && <ActionButton outline disabled={operation.busy}
          onClick={() => void mutate(`/auth/sessions/${encodeURIComponent(item.id)}`, 'DELETE', undefined, '撤销该登录会话？')}>撤销登录</ActionButton>}
      </View>)}</>}
      {tab === 3 && <>
        <View className={styles.card}><Text className={styles.heading}>举报</Text>
          <Picker range={['用户', '服务', '体验', '消息']} disabled={operation.busy} onChange={event => setReportKind(['user', 'service', 'experience', 'message'][Number(event.detail.value)])}>
            <View className={styles.input}>类型：{({ user: '用户', service: '服务', experience: '体验', message: '消息' })[reportKind]}</View></Picker>
          {input(target, setTarget, '目标ID，可从搜索结果选择')}
          <Textarea className={styles.textarea} value={reason} disabled={operation.busy} maxlength={2000} placeholder="说明举报原因（至少2字）" onInput={event => setReason(event.detail.value)} />
          <ActionButton outline disabled={operation.busy} onClick={() => void run(async () => {
            if (!target.trim() || reason.trim().length < 2) throw new Error('请填写目标和至少2字的原因');
            await api.mutation('/reports', 'POST', { kind: reportKind, target_id: target.trim(), reason: reason.trim() });
            if (operation.active()) { setReason(''); await Taro.showToast({ title: '举报已提交', icon: 'success' }); }
          }, '确认提交举报？')}>提交举报</ActionButton>
          <View className={styles.action}><ActionButton outline disabled={operation.busy || reportKind !== 'user'}
            onClick={() => void mutate(`/me/blocks/${encodeURIComponent(target.trim())}`, 'PUT', undefined, '屏蔽后双方不能发送新的私信，历史聊天保留。')}>屏蔽此用户</ActionButton></View>
        </View>
        {!blocks.length && !operation.busy && <StateView empty title="暂无屏蔽用户" />}
        {blocks.map(item => <View className={styles.card} key={item.peer_id}><Text className={styles.muted}>{item.peer_id}</Text>
          <ActionButton outline disabled={operation.busy} onClick={() => void mutate(`/me/blocks/${encodeURIComponent(item.peer_id)}`, 'DELETE', undefined, '解除屏蔽？')}>解除屏蔽</ActionButton></View>)}
      </>}
      {tab === 4 && <View className={styles.card}><Text className={styles.heading}>手机号换绑</Text>
        <Text className={styles.muted}>需要验证新旧号码；完成后退出全部会话。</Text>
        {input(phone, setPhone, '新手机号', true)}{sms('change_phone_old')}{input(oldCode, setOldCode, '旧号验证码', true)}
        {sms('change_phone_new')}{input(newCode, setNewCode, '新号验证码', true)}
        <View className={styles.action}><ActionButton outline disabled={operation.busy} onClick={() => void accountAction(false)}>确认换绑</ActionButton></View>
        <Text className={styles.heading}>注销账号</Text>{sms('close_account')}{input(closeCode, setCloseCode, '注销验证码', true)}
        <View className={styles.action}><ActionButton outline disabled={operation.busy} onClick={() => void accountAction(true)}>注销账号</ActionButton></View>
      </View>}
      {tab === 5 && <>
        <View className={styles.card}><Picker range={['服务', '体验']} disabled={operation.busy} onChange={event => setKind(Number(event.detail.value) ? 'experience' : 'service')}>
          <View className={styles.input}>{kind === 'service' ? '服务' : '体验'}</View></Picker>
          {input(query, setQuery, '关键词')}{input(city, setCity, '城市或地点')}{input(category, setCategory, '分类（精确名称）')}
          <ActionButton outline disabled={operation.busy} onClick={() => void run(() => loadData())}>搜索</ActionButton></View>
        {!results.length && !operation.busy && <StateView empty title="暂无匹配结果" />}
        {results.map(item => <View className={styles.card} key={item.id}><Text className={styles.heading}>{item.title}</Text><Text className={styles.muted}>{item.location}</Text>
          <ActionButton outline onClick={() => void Taro.navigateTo({ url: `/pages/${item.kind}-detail/index?id=${encodeURIComponent(item.id)}` })}>查看详情</ActionButton>
          <View className={styles.action}><ActionButton outline onClick={() => { setReportKind(item.kind); setTarget(item.id); setTab(3); }}>举报内容</ActionButton></View>
          <View className={styles.action}><ActionButton outline onClick={() => { setReportKind('user'); setTarget(item.host_id); setTab(3); }}>屏蔽或举报主理人</ActionButton></View>
        </View>)}
      </>}
      {tab === 6 && <>
        {!feedbacks.length && !operation.busy && <StateView empty title="暂无举报或反馈处理记录" />}
        {feedbacks.map(item => <View className={styles.card} key={item.id}>
          <Text className={styles.heading}>{item.category.startsWith('report_') ? '举报' : '意见反馈'}</Text>
          <Text>{item.status === 'pending' ? '待处理' : item.status === 'processing' ? '处理中' : '已处理'}</Text>
          {item.admin_note && <Text className={styles.muted}>{item.admin_note}</Text>}
        </View>)}
      </>}
      {more && [0, 1, 2, 3, 5, 6].includes(tab) && <ActionButton outline disabled={operation.busy} onClick={() => void run(() => loadData(true))}>加载更多</ActionButton>}
    </>}
  </View>;
}
