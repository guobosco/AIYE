import React, { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
import { Image, Input, ScrollView, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { API_BASE, getItem, getMessages, markRead, mediaUrl, request, sendMessage, showError, upload } from '@/services/api';
import { getSessionGeneration, requireLogin, useSession } from '@/store/session';
import { onboardingDestination } from '@/utils/authentication';
import { ActionButton, Avatar, StateView } from '@/components/UI';
import { displayLocation, formatTime, itemUrl, uniqueId } from '@/utils/catalog';
import type { ChatMessage, MessageInput, User } from '@/types/models';
import styles from './index.module.scss';

export default function ThreadPage() {
  const params = Taro.getCurrentInstance().router?.params || {};
  const id = params.id || '';
  const { user, token } = useSession();
  const loginGeneration = getSessionGeneration();
  const viewKey = `${id}.${loginGeneration}`;
  const latestKey = useRef(viewKey);
  latestKey.current = viewKey;
  const onboardingRoute = onboardingDestination(user);
  const [dataKey, setDataKey] = useState(viewKey);
  const [peer, setPeer] = useState<User | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [visible, setVisible] = useState(false);
  const [scrollTarget, setScrollTarget] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [windowHeight] = useState(() => Taro.getSystemInfoSync().windowHeight);
  const operation = useRef<{ key: string; generation: number } | null>(null);
  const textRevision = useRef(0);
  const nearBottom = useRef(true);
  const initialized = useRef(false);
  const refreshTask = useRef<{ key: string } | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  useDidShow(() => setVisible(true));
  useDidHide(() => setVisible(false));
  useEffect(() => {
    if (process.env.TARO_ENV !== 'weapp') return;
    const onKeyboard = (event: { height: number }) => setKeyboardHeight(Math.max(0, event.height));
    Taro.onKeyboardHeightChange(onKeyboard);
    return () => { Taro.offKeyboardHeightChange(onKeyboard); };
  }, []);
  const activeView = () => alive.current && latestKey.current === viewKey && getSessionGeneration() === loginGeneration;
  const merge = (next: ChatMessage[], scroll = true) => {
    if (!activeView()) return;
    setMessages(current => [...new Map([...current, ...next].map(message => [message.id, message])).values()]
      .filter(message => !message.is_deleted).sort((a, b) => a.created_at - b.created_at));
    if (scroll && next.length && nearBottom.current) setScrollTarget(`message${next[next.length - 1].id.replace(/[^a-zA-Z0-9]/g, '')}`);
  };
  const load = async () => {
    const currentGeneration = generation.current;
    if (!activeView() || !id || !token || onboardingRoute) return;
    if (refreshTask.current?.key === viewKey) return;
    const task = { key: viewKey };
    refreshTask.current = task;
    try {
      const next = await getMessages(id);
      if (!activeView() || currentGeneration !== generation.current) return;
      merge(next);
      if (!initialized.current) { setHasMore(next.length === 100); initialized.current = true; }
      await markRead(id, next[next.length - 1]?.id);
      if (!activeView() || currentGeneration !== generation.current) return;
      setError('');
    } catch (err) { if (activeView() && currentGeneration === generation.current) setError(err instanceof Error ? err.message : '加载失败'); }
    finally {
      if (refreshTask.current === task) refreshTask.current = null;
      if (activeView() && currentGeneration === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    const currentGeneration = ++generation.current;
    alive.current = true;
    initialized.current = false; nearBottom.current = true;
    operation.current = null; refreshTask.current = null; textRevision.current++;
    setMessages([]); setPeer(null); setText(''); setBusy(false); setError('');
    setScrollTarget(''); setKeyboardHeight(0); setDataKey(viewKey); setLoading(true); setHasMore(false);
    if (token && user && onboardingRoute) requireLogin();
    else if (token && user && id) {
      void load();
      if (params.peer) void request<User>(`/users/${encodeURIComponent(params.peer)}`).then(value => {
        if (activeView() && currentGeneration === generation.current) { setPeer(value); void Taro.setNavigationBarTitle({ title: value.name || '聊天' }); }
      }).catch(error => { if (activeView() && currentGeneration === generation.current) showError(error); });
    }
    return () => { alive.current = false; operation.current = null; };
  }, [viewKey, onboardingRoute, user?.id]);
  useEffect(() => {
    if (!visible || !token || !user || !id || onboardingRoute) return;
    void load();
    let cancelled = false;
    let socket: Taro.SocketTask | undefined;
    void Taro.connectSocket({ url: `${API_BASE.replace(/^http/, 'ws')}/ws/chat?token=${encodeURIComponent(token)}` }).then(task => {
      if (cancelled || !activeView()) { void task.close({}); return; }
      socket = task;
      task.onMessage(event => {
        if (cancelled || !activeView()) return;
        try {
          const payload = JSON.parse(String(event.data)) as { type: string; message?: ChatMessage };
          if (payload.message?.conversation_id === id) {
            merge([payload.message], payload.message.sender_id === user?.id || nearBottom.current);
            void markRead(id, payload.message.id).catch(error => { if (!cancelled && activeView()) showError(error); });
          }
        } catch { console.error('[Chat] Invalid socket payload'); }
      });
      task.onError(() => console.error('[Chat] Socket disconnected; REST refresh remains active'));
    }).catch(() => console.error('[Chat] Socket unavailable; using REST refresh'));
    const timer = setInterval(() => { void load(); }, 10000);
    return () => { cancelled = true; clearInterval(timer); if (socket) void socket.close({}); };
  }, [viewKey, token, visible, onboardingRoute, user?.id]);
  const beginOperation = () => {
    if (!activeView() || !id || operation.current || !requireLogin()) return null;
    const task = { key: viewKey, generation: loginGeneration };
    operation.current = task; setBusy(true);
    return task;
  };
  const currentOperation = (task: { key: string; generation: number }) => activeView()
    && operation.current === task && task.key === viewKey && task.generation === loginGeneration;
  const finishOperation = (task: { key: string; generation: number }) => {
    if (operation.current !== task) return;
    operation.current = null;
    if (activeView()) setBusy(false);
  };
  const send = async (body: MessageInput, task: { key: string; generation: number }) => {
    if (!currentOperation(task)) return false;
    try {
      const message = await sendMessage(id, { ...body, client_message_id: body.client_message_id || uniqueId() });
      if (!currentOperation(task)) return false;
      nearBottom.current = true;
      merge([message]); setError('');
      return true;
    } catch (err) { if (currentOperation(task)) showError(err); return false; }
  };
  const sendText = async () => {
    const content = text.trim();
    if (!content) return;
    const task = beginOperation();
    if (!task) return;
    const revision = textRevision.current;
    try {
      if (await send({ type: 'text', content }, task) && currentOperation(task) && textRevision.current === revision) setText('');
    } finally { finishOperation(task); }
  };
  const sendImage = async () => {
    const task = beginOperation();
    if (!task) return;
    try {
      const result = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] });
      if (!currentOperation(task)) return;
      if (!result.tempFilePaths[0]) return;
      const file = await upload(result.tempFilePaths[0], 'chat');
      if (!currentOperation(task)) return;
      await send({ type: 'image', content: '图片', attachment_url: file.url, object_key: file.object_key,
        attachment_name: 'image.jpg', extra: { mime_type: 'image/jpeg' } }, task);
    } catch (err) {
      if (currentOperation(task) && !(typeof err === 'object' && err !== null && 'errMsg' in err && String(err.errMsg).includes('cancel'))) showError(err);
    } finally { finishOperation(task); }
  };
  const sendLocation = async () => {
    const task = beginOperation();
    if (!task) return;
    try {
      const location = await Taro.chooseLocation({});
      if (!currentOperation(task)) return;
      await send({ type: 'location', content: location.name || location.address, extra: {
        title: location.name, address: location.address, latitude: String(location.latitude), longitude: String(location.longitude),
      } }, task);
    } catch (err) {
      if (currentOperation(task) && !(typeof err === 'object' && err !== null && 'errMsg' in err && String(err.errMsg).includes('cancel'))) showError(err);
    } finally { finishOperation(task); }
  };
  const sendCard = async () => {
    if (!params.service && !params.experience) {
      void Taro.showToast({ title: '从详情页问询可发送内容卡片', icon: 'none' }); return;
    }
    const kind = params.experience ? 'experience' : 'service';
    const task = beginOperation();
    if (!task) return;
    try {
      const item = await getItem(kind, params.experience || params.service || '');
      if (!currentOperation(task)) return;
      await send({ type: kind === 'service' ? 'service' : 'experience', content: item.title, extra: {
        [`${kind}_id`]: item.id, title: item.title, description: item.description, price_text: item.price_text,
        category: item.category, location: displayLocation(item.location), cover_image: item.cover_image_url,
      } }, task);
    } catch (err) { if (currentOperation(task)) showError(err); }
    finally { finishOperation(task); }
  };
  const loadHistory = async () => {
    if (!messages.length) return;
    const task = beginOperation();
    if (!task) return;
    nearBottom.current = false;
    try {
      const next = await getMessages(id, messages[0].created_at);
      if (!currentOperation(task)) return;
      merge(next, false); setHasMore(next.length === 100);
    } catch (error) { if (currentOperation(task)) showError(error); }
    finally { finishOperation(task); }
  };
  if (!token) return <StateView onLogin={requireLogin} />;
  if (!user || dataKey !== viewKey) return <StateView loading />;
  if (onboardingRoute) return <View className={styles.page}>
    <StateView empty title={onboardingRoute.includes('bind-phone') ? '请先绑定手机号' : '请先完善资料'} />
    <ActionButton onClick={requireLogin}>{onboardingRoute.includes('bind-phone') ? '去绑定手机号' : '去完善资料'}</ActionButton>
  </View>;
  if (!id) return <StateView error="未找到有效会话" />;
  const openMessage = (message: ChatMessage) => {
    if (message.type === 'image' && message.attachment_url) {
      const url = mediaUrl(message.attachment_url);
      void Taro.previewImage({ current: url, urls: [url] });
    } else if (message.type === 'location') {
      const latitude = Number(message.extra.latitude), longitude = Number(message.extra.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) void Taro.openLocation({
        latitude, longitude, name: message.extra.title, address: message.extra.address,
      }).catch(showError);
    } else if (message.extra?.service_id || message.extra?.experience_id) {
      const kind = message.extra.experience_id ? 'experience' : 'service';
      void Taro.navigateTo({ url: itemUrl(kind, message.extra.experience_id || message.extra.service_id) });
    }
  };
  return <View className={styles.page} style={process.env.TARO_ENV === 'weapp'
    ? { height: `${Math.max(200, windowHeight - keyboardHeight)}px` } : undefined}>
    {peer && <View className={styles.header} onClick={() => Taro.navigateTo({ url: `/pages/profile/index?id=${encodeURIComponent(peer.id)}` })}>
      <Avatar url={peer.photo_url} name={peer.name} size={64} /><Text className={styles.name}>{peer.name}</Text><Text>›</Text>
    </View>}
    {error && <View className={styles.notice} onClick={() => void load()}>{error}，点击重试</View>}
    <ScrollView scrollY className={styles.history} scrollIntoView={scrollTarget}
      onScroll={event => {
        const { scrollHeight, scrollTop } = event.detail;
        const viewport = Taro.getSystemInfoSync().windowHeight;
        nearBottom.current = scrollHeight - scrollTop < viewport * 0.85;
      }} onScrollToLower={() => { nearBottom.current = true; }} lowerThreshold={100}>
      <View className={styles.list}><StateView loading={loading} />
        {hasMore && <Text className={styles.load} onClick={() => void loadHistory()}>加载更早消息</Text>}
        {messages.map((message, index) => <View key={message.id} id={`message${message.id.replace(/[^a-zA-Z0-9]/g, '')}`}>
          {(index === 0 || message.created_at - messages[index - 1].created_at > 300000) && <View className={styles.time}>{formatTime(message.created_at)}</View>}
          <View className={classnames(styles.row, message.sender_id === user?.id && styles.mine)}>
            <Avatar url={message.sender_id === user?.id ? user?.photo_url : peer?.photo_url}
              name={message.sender_id === user?.id ? user?.name : peer?.name} size={64} />
            <View className={classnames(styles.bubble,
              message.type !== 'image' && message.type !== 'location'
                && !message.extra?.service_id && !message.extra?.experience_id && styles.textBubble,
              message.type === 'location' && styles.locationBubble)} onClick={() => openMessage(message)}>
              {message.type === 'image' ? <Image className={styles.image} src={mediaUrl(message.attachment_url)} mode="aspectFill"
                onError={() => console.error('[Chat] Image failed', message.id)} />
                : message.type === 'location' ? <View><Text className={styles.cardTitle}>{message.extra?.title || '位置'}</Text>
                  <Text className={styles.cardMeta}>{message.extra?.address}</Text></View>
                  : message.extra?.service_id || message.extra?.experience_id ? <View><Text className={styles.cardTitle}>{message.extra.title || message.content}</Text>
                    <Text className={styles.cardMeta}>{displayLocation(message.extra.location)}</Text><Text className={styles.cardMeta}>{message.extra.price_text}</Text>
                    {message.extra.inquiry_date && <Text>{message.content}</Text>}</View>
                    : <Text>{message.content || message.attachment_name || '消息'}</Text>}
            </View>
          </View>
        </View>)}
      </View>
    </ScrollView>
    <View className={styles.composer} style={keyboardHeight ? { paddingBottom: '16rpx' } : undefined}><View className={styles.inputRow}>
      <Input className={styles.input} value={text} maxlength={5000} placeholder="发消息…" confirmType="send"
        adjustPosition={false} holdKeyboard cursorSpacing={12}
        onInput={event => { textRevision.current++; setText(event.detail.value); }} onConfirm={() => void sendText()} />
      <ActionButton small loading={busy} disabled={!text.trim()} onClick={() => void sendText()}>发送</ActionButton>
    </View><View className={styles.tools}>
      <Text className={styles.tool} onClick={() => !busy && void sendImage()}>图片</Text>
      <Text className={styles.tool} onClick={() => !busy && void sendLocation()}>位置</Text>
      {(params.service || params.experience) && <Text className={styles.tool} onClick={() => !busy && void sendCard()}>内容卡片</Text>}
    </View></View>
  </View>;
}
