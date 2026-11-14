import React, { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Image, Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components';
import classnames from 'classnames';
import { mediaUrl, request, showError, upload } from '@/services/api';
import { getSession, requireLogin, updateSessionUser } from '@/store/session';
import { ActionButton, Avatar, MenuRow, StateView, Tags } from '@/components/UI';
import { splitLines } from '@/utils/catalog';
import type { User } from '@/types/models';
import styles from './index.module.scss';

const INTERESTS = ['旅行', '摄影', '美食', '音乐', '运动', '潜水', '冲浪', '徒步', '阅读', '艺术', '电影', '宠物', '露营', '咖啡', '手作', '舞蹈'];
const FIELDS: Array<{ key: keyof User; label: string; placeholder?: string }> = [
  { key: 'name', label: '姓名或昵称' },
  { key: 'job_title', label: '职业' }, { key: 'education', label: '教育背景' },
  { key: 'birth_decade', label: '出生年代', placeholder: '例如：95后' },
  { key: 'living_country', label: '常住国家' }, { key: 'living_city', label: '常住城市' },
  { key: 'middle_school_favorite_song', label: '中学最喜欢的歌' },
];
export default function ProfileEditPage() {
  const [user, setUser] = useState<User | null>(getSession().user);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [customTag, setCustomTag] = useState('');
  const [languages, setLanguages] = useState(getSession().user?.spoken_languages?.join('、') || '');
  const load = async () => {
    if (!requireLogin()) return;
    setLoading(true);
    try {
      const loaded = await request<User>('/auth/me');
      setUser(loaded); setLanguages(loaded.spoken_languages?.join('、') || ''); setError('');
    }
    catch (err) { setError(err instanceof Error ? err.message : '加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const update = <K extends keyof User>(key: K, value: User[K]) => setUser(current => current ? { ...current, [key]: value } : current);
  const selectImage = async (avatar: boolean) => {
    if (busy || !user) return;
    try {
      const result = await Taro.chooseImage({ count: avatar ? 1 : Math.min(9, 18 - (user.profile_image_urls?.length || 0)), sizeType: ['compressed'] });
      setBusy(true);
      const uploaded: string[] = [];
      for (const path of result.tempFilePaths) uploaded.push((await upload(path, 'avatar')).url);
      if (avatar) {
        setUser(current => current ? { ...current, photo_url: uploaded[0],
          profile_image_urls: [...new Set([uploaded[0], ...(current.profile_image_urls || [])])].slice(0, 18) } : current);
      } else update('profile_image_urls', [...new Set([...(user.profile_image_urls || []), ...uploaded])].slice(0, 18));
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && 'errMsg' in err && String(err.errMsg).includes('cancel'))) showError(err);
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (!user || busy) return;
    if (!user.name.trim() || !user.gender || !user.region || !user.photo_url) {
      void Taro.showToast({ title: '请填写昵称、性别、地区并设置头像', icon: 'none' }); return;
    }
    if (user.height_cm < 0 || user.height_cm > 250 || user.weight_kg < 0 || user.weight_kg > 300) {
      void Taro.showToast({ title: '请检查身高体重', icon: 'none' }); return;
    }
    setBusy(true);
    try {
      const saved = await request<User>(`/users/${encodeURIComponent(user.id)}`, 'PUT', {
        ...user, name: user.name.trim(), spoken_languages: [...new Set(languages.split(/[,，、\n]/).map(value => value.trim()).filter(Boolean))],
        is_profile_completed: true, updated_at: Date.now(),
      });
      updateSessionUser(saved);
      void Taro.showToast({ title: '已保存', icon: 'success' });
      void Taro.navigateBack({ fail: () => Taro.switchTab({ url: '/pages/mine/index' }) });
    } catch (err) { showError(err); }
    finally { setBusy(false); }
  };
  if (!user || loading) return <StateView loading={loading} error={error} onRetry={load} />;
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>编辑资料</Text><View onClick={() => void selectImage(true)}><Avatar url={user.photo_url} name={user.name} size={128} /></View></View>
    <Text className={styles.link} onClick={() => void selectImage(true)}>更换头像</Text>
    <MenuRow label="爱野 ID" value={user.pei_pei_id || user.id} arrow={false} />
    {FIELDS.map(field => <View key={field.key} className={styles.field}><Text className={styles.label}>{field.label}</Text>
      <Input className={styles.input} value={String(user[field.key] || '')} maxlength={field.key === 'name' ? 30 : 100}
        placeholder={field.placeholder || `填写${field.label}`} onInput={event => update(field.key, event.detail.value)} /></View>)}
    <View className={styles.field}><Text className={styles.label}>性别</Text><Picker range={['男', '女', '其他']} onChange={event => update('gender', ['男', '女', '其他'][Number(event.detail.value)])}>
      <View className={styles.picker}>{user.gender || '选择性别'}<Text>›</Text></View></Picker></View>
    <View className={styles.field}><Text className={styles.label}>地区</Text><Picker mode="region" onChange={event => update('region', event.detail.value.join(''))}>
      <View className={styles.picker}>{user.region || '选择省市区'}<Text>›</Text></View></Picker></View>
    <View className={styles.field}><Text className={styles.label}>自我介绍</Text><Textarea className={styles.textarea} value={user.signature || ''} maxlength={1000}
      onInput={event => update('signature', event.detail.value)} /></View>
    <View className={styles.field}><Text className={styles.label}>身高（cm）</Text><Input className={styles.input} type="number" value={user.height_cm ? String(user.height_cm) : ''}
      onInput={event => update('height_cm', Number(event.detail.value))} /></View>
    <View className={styles.field}><Text className={styles.label}>体重（kg）</Text><Input className={styles.input} type="digit" value={user.weight_kg ? String(user.weight_kg) : ''}
      onInput={event => update('weight_kg', Number(event.detail.value))} /></View>
    <View className={styles.row}><Text className={styles.rowBody}>身高体重仅自己可见</Text><Switch color="#E0115F" checked={user.height_weight_private}
      onChange={event => update('height_weight_private', event.detail.value)} /></View>
    <View className={styles.field}><Text className={styles.label}>会说的语言（逗号分隔）</Text><Input className={styles.input} value={languages}
      onInput={event => setLanguages(event.detail.value)} /></View>
    <View className={styles.section}><Text className={styles.heading}>兴趣标签</Text><Tags values={[...new Set([...INTERESTS, ...(user.tags || [])])]} selected={user.tags || []}
      onToggle={value => update('tags', user.tags?.includes(value) ? user.tags.filter(tag => tag !== value) : [...(user.tags || []), value].slice(0, 30))} />
      <View className={styles.search}><Input className={styles.input} value={customTag} maxlength={20} placeholder="自定义标签" onInput={event => setCustomTag(event.detail.value)} />
        <ActionButton small outline onClick={() => { update('tags', [...new Set([...(user.tags || []), ...splitLines(customTag)])].slice(0, 30)); setCustomTag(''); }}>添加</ActionButton></View>
    </View>
    <View className={styles.section}><Text className={styles.heading}>照片墙</Text><View className={styles.photos}>
      {(user.profile_image_urls || []).map(url => <View key={url} className={styles.photo}><Image src={mediaUrl(url)} className={styles.photoImage} mode="aspectFill"
        onError={() => console.error('[ProfileEdit] Image failed')} />
        <Text className={styles.remove} onClick={() => update('profile_image_urls', user.profile_image_urls.filter(value => value !== url))}>×</Text></View>)}
      {(user.profile_image_urls?.length || 0) < 18 && <View className={classnames(styles.photo, styles.addPhoto)} onClick={() => void selectImage(false)}>+</View>}
    </View></View>
    <View className={styles.spacer} /><View className={styles.bottom}><View><ActionButton loading={busy} onClick={() => void save()}>保存资料</ActionButton></View></View>
  </View>;
}
