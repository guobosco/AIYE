import React, { useEffect, useMemo, useRef, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { Input, ScrollView, Text, View } from '@tarojs/components';
import classnames from 'classnames';
import { getExperienceFavorites, getItem, getWishlist, saveWishlist, showError } from '@/services/api';
import { getSession, requireLogin, useSession } from '@/store/session';
import { useResource } from '@/hooks/useResource';
import { ActionButton, StateView } from '@/components/UI';
import ItemCard from '@/components/ItemCard';
import type { Experience, Service, WishlistProfile } from '@/types/models';
import styles from '@/styles/page.module.scss';

export default function WishlistPage() {
  const session = useSession();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('全部服务');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [groupEditor, setGroupEditor] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const resource = useResource(async () => {
    if (!getSession().token) return { profile: { service_ids: [], groups: [] }, services: [], experiences: [] };
    const [profile, experienceIds] = await Promise.all([getWishlist(), getExperienceFavorites()]);
    // Unpublished or removed favorites may no longer be viewable.
    const [serviceResults, experienceResults] = await Promise.all([
      Promise.allSettled(profile.service_ids.map(id => getItem('service', id))),
      Promise.allSettled(experienceIds.map(id => getItem('experience', id))),
    ]);
    return {
      profile,
      services: serviceResults.flatMap(result => result.status === 'fulfilled' ? [result.value as Service] : []),
      experiences: experienceResults.flatMap(result => result.status === 'fulfilled' ? [result.value as Experience] : []),
    };
  }, { profile: { service_ids: [], groups: [] } as WishlistProfile, services: [] as Service[], experiences: [] as Experience[] }, session.user?.id || 'guest');
  useDidShow(() => { void resource.refresh(); });
  useEffect(() => {
    setGroup('全部服务'); setEditing(false); setGroupEditor(null);
  }, [session.user?.id]);
  const save = async (profile: WishlistProfile) => {
    if (saveLock.current) return false;
    saveLock.current = true;
    setSaving(true);
    try {
      const updated = await saveWishlist(profile);
      resource.setData(data => ({ ...data, profile: updated }));
      return true;
    } catch (error) { showError(error); return false; }
    finally { saveLock.current = false; setSaving(false); }
  };
  const newGroup = () => { setGroupName(''); setGroupEditor(''); };
  const saveGroup = async () => {
    const name = groupName.trim();
    if (groupEditor === null || !name) return;
    if (['全部服务', '体验', ...resource.data.profile.groups.filter(value => value.name !== groupEditor).map(value => value.name)].includes(name)) {
      void Taro.showToast({ title: '分组名称已存在', icon: 'none' }); return;
    }
    const groups = groupEditor
      ? resource.data.profile.groups.map(value => value.name === groupEditor ? { ...value, name } : value)
      : [...resource.data.profile.groups, { name, service_ids: [] }];
    if (await save({ ...resource.data.profile, groups })) { setGroup(name); setGroupEditor(null); }
  };
  const manageGroup = async () => {
    if (group === '全部服务' || group === '体验') return;
    const result = await Taro.showActionSheet({ itemList: ['重命名分组', '删除分组'] }).catch(() => null);
    if (!result) return;
    if (result.tapIndex === 0) {
      setGroupName(group); setGroupEditor(group);
    } else {
      const dialog = await Taro.showModal({ title: '删除分组', content: '仅删除分组，不取消收藏。' });
      if (dialog.confirm) {
        if (await save({ ...resource.data.profile, groups: resource.data.profile.groups.filter(value => value.name !== group) })) setGroup('全部服务');
      }
    }
  };
  const assignGroup = async (item: Service) => {
    if (saving) return;
    const groups = resource.data.profile.groups;
    if (!groups.length) { await newGroup(); return; }
    const result = await Taro.showActionSheet({ itemList: ['不分组', ...groups.map(value => value.name)] }).catch(() => null);
    if (!result) return;
    await save({ ...resource.data.profile, groups: groups.map((value, index) => ({
      ...value, service_ids: index === result.tapIndex - 1
        ? [...new Set([...value.service_ids, item.id])] : value.service_ids.filter(id => id !== item.id),
    })) });
  };
  const services = useMemo(() => {
    const selectedIds = resource.data.profile.groups.find(value => value.name === group)?.service_ids;
    return resource.data.services.filter(item => (!selectedIds || selectedIds.includes(item.id))
      && `${item.title} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  }, [resource.data, group, query]);
  const experiences = resource.data.experiences.filter(item => `${item.title} ${item.location}`.toLowerCase().includes(query.toLowerCase()));
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>心愿单</Text>
      {session.token && <Text className={styles.link} onClick={() => setEditing(value => !value)}>{editing ? '完成' : '管理'}</Text>}
    </View>
    {!session.token ? <StateView onLogin={requireLogin} /> : <>
      <Input className={styles.input} placeholder="搜索心愿单" value={query} onInput={event => setQuery(event.detail.value)} />
      <View className={styles.section}><ScrollView scrollX className={styles.tabs}><View className={styles.tabRow}>
        {['全部服务', '体验', ...resource.data.profile.groups.map(value => value.name)].map(name =>
          <View key={name} className={classnames(styles.tab, group === name && styles.active)} onClick={() => setGroup(name)}>{name}</View>)}
      </View></ScrollView>
      {editing && <View className={styles.actions}><View><ActionButton small outline onClick={() => void newGroup()}>新建分组</ActionButton></View>
        {group !== '全部服务' && group !== '体验' && <View><ActionButton small outline onClick={() => void manageGroup()}>编辑分组</ActionButton></View>}
      </View>}</View>
      {groupEditor !== null && <View className={styles.section}>
        <Text className={styles.heading}>{groupEditor ? '重命名分组' : '新建分组'}</Text>
        <Input className={styles.input} value={groupName} maxlength={30} placeholder="分组名称" onInput={event => setGroupName(event.detail.value)} />
        <View className={styles.actions}><View><ActionButton small outline disabled={saving} onClick={() => setGroupEditor(null)}>取消</ActionButton></View>
          <View><ActionButton small loading={saving} disabled={!groupName.trim()} onClick={() => void saveGroup()}>保存分组</ActionButton></View></View>
      </View>}
      <StateView loading={resource.loading} error={resource.error}
        empty={group === '体验' ? !experiences.length : !services.length} title="暂无收藏" onRetry={resource.error ? resource.refresh : undefined} />
      {(group === '体验' ? experiences : services).map(item => <View key={item.id}>
        <ItemCard item={item} kind={group === '体验' ? 'experience' : 'service'} row />
        {editing && <View className={styles.actions}>
          {group !== '体验' && <Text className={styles.link} onClick={() => void assignGroup(item as Service)}>移动分组</Text>}
          <Text className={styles.link} onClick={async () => {
            const result = await Taro.showModal({ title: '取消收藏', content: item.title });
            if (!result.confirm) return;
            const { toggleFavorite } = await import('@/services/api');
            try { await toggleFavorite(group === '体验' ? 'experience' : 'service', item.id); await resource.refresh(); }
            catch (error) { showError(error); }
          }}>取消收藏</Text>
        </View>}
      </View>)}
    </>}
  </View>;
}
