import React, { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Image, Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components';
import classnames from 'classnames';
import { getItem, mediaUrl, request, saveItem, showError, upload } from '@/services/api';
import { getSession, getSessionGeneration, requireLogin, useSession } from '@/store/session';
import { onboardingDestination } from '@/utils/authentication';
import { ActionButton, StateView, Tags } from '@/components/UI';
import { DECLARATIONS, displayLocation, EXPERIENCE_CATEGORIES, SERVICE_CATEGORIES, splitLines, uniqueId } from '@/utils/catalog';
import { decodePriceTiers, encodePriceTiers } from '@/utils/pricing';
import { decodeRanges } from '@/utils/booking';
import { movePublicationImage, normalizePublicationTags, publicationHints, publicationOptions } from '@/utils/publication';
import type { PriceTier } from '@/utils/pricing';
import type { DetailStep, Experience, ItemKind, Service, User } from '@/types/models';
import styles from '@/styles/page.module.scss';

type Form = Partial<Service & Experience>;
const blank = (): Form => ({
  title: '', description: '', category: '地陪', location: '', price_text: '', price_basis_text: '',
  image_urls: [], detail_steps: [], service_mode: '小时', duration_text: '', badge_text: '',
  prepayment_percent: 30, full_refund_cancel_lead_days: 1, booking_lead_hours: 0,
  booking_future_open_days: 30, auto_accept_after_payment: true, booking_time_ranges_json: '',
  service_declarations_extra: [], service_feature_tags: [], service_extra_fee_tags: [], tags: [],
  participant_ids: [], sync_to_square: true,
});
export default function PublishPage() {
  const session = useSession();
  const params = Taro.getCurrentInstance().router?.params || {};
  const [kind, setKind] = useState<ItemKind>(params.kind === 'experience' ? 'experience' : 'service');
  const [form, setForm] = useState<Form>(blank);
  const [tiers, setTiers] = useState<PriceTier[]>([{ name: '', price: '', duration_amount: 4, duration_unit: '小时' }]);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const operation = useRef(false);
  const draftIds = useRef({ service: uniqueId(), experience: uniqueId() });
  const [loading, setLoading] = useState(!!params.id);
  const [error, setError] = useState('');
  const [readyKey, setReadyKey] = useState('');
  const [declarationsText, setDeclarationsText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [retry, setRetry] = useState(0);
  const [participantQuery, setParticipantQuery] = useState('');
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({});
  const [rangeStart, setRangeStart] = useState('08:00');
  const [rangeEnd, setRangeEnd] = useState('22:00');
  const draftKey = `aiye.publish.draft.${session.user?.id || 'guest'}.${kind}.${params.id || 'new'}`;
  const formKey = `${draftKey}.${getSessionGeneration()}`;
  const onboardingRoute = onboardingDestination(session.user);
  useEffect(() => {
    setReadyKey('');
    // Password login briefly has a token while /auth/me is still loading.
    if (session.token && !session.user) { setLoading(true); return; }
    if (!requireLogin()) { setLoading(false); return; }
    let active = true;
    const hydrate = (value: Form, prices?: PriceTier[]) => {
      setForm(value);
      setDeclarationsText(value.service_declarations_extra?.join('\n') || '');
      setTagsText(value.tags?.join('，') || '');
      setTiers(prices?.length ? prices : [{ name: '', price: '', duration_amount: 4, duration_unit: '小时' }]);
    };
    const load = async () => {
      try {
        if (params.id) {
          const item = await getItem(kind, params.id);
          const ownerId = kind === 'service' ? (item as Service).creator_id : (item as Experience).host_id;
          if (ownerId !== getSession().user?.id) throw new Error('仅发布者可以编辑此内容');
          if (active) {
            hydrate({ ...blank(), ...item }, decodePriceTiers(item.price_text, item.price_basis_text));
            const stored = Taro.getStorageSync<{ form: Form; tiers: PriceTier[] }>(draftKey);
            if (stored?.form) {
              const result = await Taro.showModal({ title: '发现本机编辑备份', content: '是否恢复上次未提交的修改？服务器内容不会自动改变。' });
              if (active && result.confirm) hydrate(stored.form, stored.tiers);
            }
          }
        } else {
          const stored = Taro.getStorageSync<{ form: Form; tiers: PriceTier[] }>(draftKey);
          if (stored?.form) {
            const result = await Taro.showModal({ title: '发现未提交的内容', content: '是否恢复上次编辑？' });
            if (active && result.confirm) hydrate(stored.form, stored.tiers);
            else if (active) hydrate({ ...blank(), category: kind === 'experience' ? EXPERIENCE_CATEGORIES[0] : SERVICE_CATEGORIES[0] });
          } else if (active) hydrate({ ...blank(), category: kind === 'experience' ? EXPERIENCE_CATEGORIES[0] : SERVICE_CATEGORIES[0] });
        }
        if (active) setReadyKey(formKey);
      } catch (err) { if (active) setError(err instanceof Error ? err.message : '加载失败'); }
      finally { if (active) setLoading(false); }
    };
    setReadyKey(''); setError(''); setLoading(true); void load();
    return () => { active = false; };
  }, [kind, params.id, draftKey, formKey, onboardingRoute, retry]);
  useEffect(() => {
    if (readyKey === formKey && (form.title || form.description || form.image_urls?.length)) {
      Taro.setStorageSync(draftKey, { form: {
        ...form, id: form.id || draftIds.current[kind],
        service_declarations_extra: splitLines(declarationsText).slice(0, 30), tags: splitLines(tagsText),
      }, tiers });
    }
  }, [form, tiers, readyKey, draftKey, formKey, declarationsText, tagsText]);
  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    if (!operation.current) setForm(current => ({ ...current, [key]: value }));
  };
  const patchTier = (index: number, patch: Partial<PriceTier>) => {
    if (!operation.current) setTiers(current => current.map((tier, i) => i === index ? { ...tier, ...patch } : tier));
  };
  const addParticipant = async () => {
    if (operation.current || !participantQuery.trim()) return;
    if (new Set([getSession().user?.id, ...(form.participant_ids || [])]).size >= 20) {
      void Taro.showToast({ title: '最多添加20位参与者', icon: 'none' }); return;
    }
    operation.current = true; setBusy(true);
    try {
      const participant = await request<User>(`/users/search?query=${encodeURIComponent(participantQuery.trim())}`);
      setParticipantNames(current => ({ ...current, [participant.id]: participant.name }));
      setForm(current => ({ ...current, participant_ids: [...new Set([...(current.participant_ids || []), participant.id])].slice(0, 20) }));
      setParticipantQuery('');
    } catch (err) { showError(err); }
    finally { operation.current = false; setBusy(false); }
  };
  const addImages = async () => {
    if (operation.current || (form.image_urls?.length || 0) >= 18) return;
    const userId = session.user?.id;
    operation.current = true; setBusy(true);
    try {
      const result = await Taro.chooseImage({ count: Math.min(9, 18 - (form.image_urls?.length || 0)), sizeType: ['compressed'] });
      if (getSession().user?.id !== userId) return;
      for (const [index, path] of result.tempFilePaths.entries()) {
        setUploadProgress(`正在上传 ${index + 1}/${result.tempFilePaths.length}`);
        const url = (await upload(path, kind)).url;
        if (getSession().user?.id !== userId) return;
        setForm(current => ({ ...current, image_urls: [...new Set([...(current.image_urls || []), url])].slice(0, 18) }));
      }
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && 'errMsg' in err && String(err.errMsg).includes('cancel'))) showError(err);
    } finally { operation.current = false; setBusy(false); setUploadProgress(''); }
  };
  const setStep = (index: number, patch: Partial<DetailStep>) => update('detail_steps',
    (form.detail_steps || []).map((step, i) => i === index ? { ...step, ...patch } : step));
  const addStepImages = async (index: number) => {
    const step = form.detail_steps?.[index];
    if (operation.current || !step || step.image_urls.length >= 9) return;
    const userId = session.user?.id;
    operation.current = true; setBusy(true);
    try {
      const result = await Taro.chooseImage({ count: 9 - step.image_urls.length, sizeType: ['compressed'] });
      if (getSession().user?.id !== userId) return;
      for (const [uploadIndex, path] of result.tempFilePaths.entries()) {
        setUploadProgress(`正在上传 ${uploadIndex + 1}/${result.tempFilePaths.length}`);
        const url = (await upload(path, 'experience')).url;
        if (getSession().user?.id !== userId) return;
        setForm(current => ({ ...current, detail_steps: current.detail_steps?.map((value, i) =>
          i === index ? { ...value, image_urls: [...value.image_urls, url].slice(0, 9) } : value) }));
      }
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && 'errMsg' in err && String(err.errMsg).includes('cancel'))) showError(err);
    } finally { operation.current = false; setBusy(false); setUploadProgress(''); }
  };
  const manageImage = async (index: number) => {
    if (operation.current) return;
    const images = form.image_urls || [];
    const userId = session.user?.id;
    const actions = [
      ...(index > 0 ? ['设为封面', '前移一张'] : []),
      ...(index < images.length - 1 ? ['后移一张'] : []), '删除图片',
    ];
    operation.current = true; setBusy(true);
    try {
      const result = await Taro.showActionSheet({ itemList: actions });
      if (getSession().user?.id !== userId) return;
      const action = actions[result.tapIndex];
      setForm(current => ({ ...current, image_urls: action === '删除图片'
        ? images.filter((_, i) => i !== index)
        : movePublicationImage(images, index, action === '设为封面' ? 0 : index + (action === '前移一张' ? -1 : 1)) }));
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && 'errMsg' in err && String(err.errMsg).includes('cancel'))) showError(err);
    } finally { operation.current = false; setBusy(false); }
  };
  const submit = async (draft: boolean) => {
    if (operation.current || readyKey !== formKey || !requireLogin()) return;
    if (!draft && !form.title?.trim()) { void Taro.showToast({ title: '请填写标题', icon: 'none' }); return; }
    if (!draft && (!form.description?.trim() || !form.location?.trim() || !form.image_urls?.length)) {
      void Taro.showToast({ title: '请填写介绍、地点并上传图片', icon: 'none' }); return;
    }
    const priced = tiers.filter(tier => tier.price.trim());
    if (!draft && kind === 'service' && (!priced.length || priced.some(tier =>
      !/^\d+(\.\d{1,2})?$/.test(tier.price.replace(/^[¥￥]\s*/, '')) || Number(tier.price.replace(/^[¥￥]\s*/, '')) <= 0
      || !Number.isFinite(tier.duration_amount) || !Number.isInteger(tier.duration_amount) || tier.duration_amount < 1 || tier.duration_amount > 99999))) {
      void Taro.showToast({ title: '请填写有效价格和时长', icon: 'none' }); return;
    }
    if (!draft && kind === 'experience' && !form.price_text?.trim()) {
      void Taro.showToast({ title: '请填写体验价格', icon: 'none' }); return;
    }
    if ([form.prepayment_percent, form.full_refund_cancel_lead_days, form.booking_future_open_days, form.booking_lead_hours]
      .some(value => !Number.isFinite(value))
      || [form.prepayment_percent, form.full_refund_cancel_lead_days, form.booking_future_open_days].some(value => !Number.isInteger(value))
      || (form.prepayment_percent || 0) < 0 || (form.prepayment_percent || 0) > 100
      || (form.full_refund_cancel_lead_days || 0) > 10 || (form.full_refund_cancel_lead_days || 0) < 0
      || (form.booking_future_open_days || 0) < 7 || (form.booking_future_open_days || 0) > 180
      || (form.booking_lead_hours || 0) < 0 || (form.booking_lead_hours || 0) > 168) {
      void Taro.showToast({ title: '请检查预约及退款规则', icon: 'none' }); return;
    }
    operation.current = true; setBusy(true);
    try {
      const user = getSession().user;
      if (!user) throw new Error('请重新登录');
      const now = Date.now();
      const prices = kind === 'service' && priced.length
        ? encodePriceTiers(priced.map(tier => ({ ...tier, price: `¥${tier.price.replace(/^[¥￥]\s*/, '')}` }))) : {};
      const options = publicationOptions(form.category);
      const payload: Form = {
        ...form, ...prices, id: params.id || form.id || draftIds.current[kind], title: form.title?.trim() || '未命名草稿',
        service_declarations_extra: splitLines(declarationsText).slice(0, 30), tags: splitLines(tagsText).slice(0, 30),
        cover_image_url: form.image_urls?.[0] || '', created_at: form.created_at || now, updated_at: now,
        creator_id: user.id, creator: user.name, host_id: user.id, host_name: user.name,
        participant_ids: [...new Set([user.id, ...(form.participant_ids || [])])].slice(0, 20),
        service_feature_tags: normalizePublicationTags(form.service_feature_tags || [], options.features),
        service_extra_fee_tags: normalizePublicationTags(form.service_extra_fee_tags || [], options.fees),
        is_draft: draft, review_status: draft ? 'draft' : 'pending_review', is_deleted: false,
      };
      await saveItem(kind, payload, !!params.id);
      Taro.removeStorageSync(draftKey);
      setReadyKey('');
      void Taro.showToast({ title: draft ? '已保存草稿' : '已提交审核', icon: 'success' });
      void Taro.redirectTo({ url: `/pages/published/index?kind=${kind}` });
    } catch (err) { showError(err); }
    finally { operation.current = false; setBusy(false); }
  };
  if (!session.token) return <StateView onLogin={requireLogin} />;
  if (loading || error || readyKey !== formKey) return <StateView loading={!error && (loading || readyKey !== formKey)} error={error} onRetry={() => setRetry(value => value + 1)} />;
  const categories = kind === 'service' ? SERVICE_CATEGORIES : EXPERIENCE_CATEGORIES;
  const options = publicationOptions(form.category);
  const hints = publicationHints(form.category);
  return <View className={styles.page}>
    <View className={styles.header}><Text className={styles.title}>{params.id ? '编辑' : '发布'}{kind === 'service' ? '服务' : '体验'}</Text></View>
    <ActionButton outline disabled={busy} onClick={async () => {
      const generation = getSessionGeneration();
      const result = await Taro.showModal({ title: '离开编辑？', content: '内容会保留在本机备份，尚未保存到服务器。' });
      if (result.confirm && getSessionGeneration() === generation) await Taro.navigateBack({});
    }}>保留备份并返回</ActionButton>
    <Text className={styles.muted}>编辑内容自动备份到本机；跨端继续请保存服务器草稿。已成功上传的图片会保留。</Text>
    {uploadProgress && <Text className={styles.muted}>{uploadProgress}</Text>}
    {!params.id && <View className={styles.actions}>
      <View><ActionButton small outline={kind !== 'service'} onClick={() => !busy && setKind('service')}>服务</ActionButton></View>
      <View><ActionButton small outline={kind !== 'experience'} onClick={() => !busy && setKind('experience')}>体验</ActionButton></View>
    </View>}
    <View className={styles.section}>
      <View className={styles.field}><Text className={styles.label}>分类</Text><Picker range={categories} value={Math.max(0, categories.indexOf(form.category || ''))}
        onChange={event => update('category', categories[Number(event.detail.value)])}><View className={styles.picker}>{form.category}<Text>›</Text></View></Picker></View>
      <View className={styles.field}><Text className={styles.label}>标题</Text><Input className={styles.input} maxlength={100} value={form.title}
        placeholder={kind === 'service' ? hints.titlePlaceholder : '概括你的体验'} onInput={event => update('title', event.detail.value)} /></View>
      <View className={styles.field}><Text className={styles.label}>详细介绍</Text><Textarea className={styles.textarea} maxlength={10000} value={form.description}
        placeholder={kind === 'service' ? hints.descriptionPlaceholder : '体验内容、流程、适合人群及注意事项'} onInput={event => update('description', event.detail.value)} /></View>
      {kind === 'service' && hints.categoryTip && <Text className={styles.muted}>{hints.categoryTip}</Text>}
      <View className={styles.field}><Text className={styles.label}>地点</Text><Input className={styles.input} value={displayLocation(form.location)}
        placeholder="省市及服务地点" onInput={event => update('location', event.detail.value)} />
        <Text className={styles.link} onClick={async () => {
          if (operation.current) return;
          const userId = session.user?.id;
          operation.current = true; setBusy(true);
          try {
            const location = await Taro.chooseLocation({});
            if (getSession().user?.id === userId) setForm(current => ({ ...current, location: location.address || location.name }));
          }
          catch (err) { if (!(typeof err === 'object' && err !== null && 'errMsg' in err && String(err.errMsg).includes('cancel'))) showError(err); }
          finally { operation.current = false; setBusy(false); }
        }}>地图选择地点</Text></View>
      <Text className={styles.heading}>图片</Text><View className={styles.photos}>
        {(form.image_urls || []).map((url, index) => <View key={`${url}-${index}`} className={styles.photo} onLongPress={() => void manageImage(index)}>
          <Image src={mediaUrl(url)} className={styles.photoImage} mode="aspectFill" onError={() => console.error('[Publish] Image failed')}
            onClick={() => { if (!operation.current) void Taro.previewImage({ current: mediaUrl(url), urls: (form.image_urls || []).map(mediaUrl) }); }} />
          <Text className={styles.remove} onClick={() => update('image_urls', form.image_urls?.filter((_, i) => i !== index))}>×</Text>
          {index === 0 && <Text className={styles.badge}>封面</Text>}
          {index > 0 && <Text className={styles.badge} onClick={() => !busy && update('image_urls',
            [url, ...(form.image_urls || []).filter((_, i) => i !== index)])}>设为封面</Text>}
        </View>)}
        {(form.image_urls?.length || 0) < 18 && <View className={classnames(styles.photo, styles.addPhoto)} onClick={() => void addImages()}>+</View>}
      </View><Text className={styles.muted}>第一张图片为封面，最多18张。点击预览，长按调整顺序或删除。</Text>
    </View>
    {kind === 'service' ? <>
      <View className={styles.section}><Text className={styles.heading}>价格档位</Text>
        {tiers.map((tier, index) => <View key={index} className={styles.surface}>
          <View className={styles.field}><Text className={styles.label}>档位名称</Text><Input className={styles.input} value={tier.name} placeholder={`档位${index + 1}`}
            onInput={event => patchTier(index, { name: event.detail.value })} /></View>
          <View className={styles.field}><Text className={styles.label}>金额（元）</Text><Input className={styles.input} type="digit" value={tier.price.replace(/^[¥￥]\s*/, '')}
            onInput={event => patchTier(index, { price: event.detail.value })} /></View>
          <View className={styles.search}><Input className={styles.input} type="number" value={String(tier.duration_amount)}
            onInput={event => patchTier(index, { duration_amount: Number(event.detail.value) })} />
            <Picker range={['小时', '分钟']} onChange={event => patchTier(index, { duration_unit: ['小时', '分钟'][Number(event.detail.value)] })}><View className={styles.picker}>{tier.duration_unit}</View></Picker></View>
          {tiers.length > 1 && <Text className={styles.link} onClick={() => !operation.current && setTiers(current => current.filter((_, i) => i !== index))}>删除档位</Text>}
        </View>)}
        {tiers.length < 10 && <ActionButton small outline disabled={busy} onClick={() => setTiers(current => [...current, { name: '', price: '', duration_amount: 4, duration_unit: '小时' }])}>添加档位</ActionButton>}
        <Text className={styles.muted}>各档位分别设置时长，支持小时或分钟。默认时长为4小时。</Text>
      </View>
      <View className={styles.section}><Text className={styles.heading}>服务参与者</Text>
        <Text className={styles.muted}>发布者默认参与，最多20人。添加参与者仅保存展示信息，不授予编辑或收款权限。</Text>
        <View className={styles.search}><Input className={styles.input} value={participantQuery} maxlength={100}
          placeholder="手机号或爱野 ID" onInput={event => setParticipantQuery(event.detail.value)} />
          <ActionButton small outline loading={busy} onClick={() => void addParticipant()}>添加</ActionButton></View>
        {(form.participant_ids || []).filter(id => id !== getSession().user?.id).map(id => <View key={id} className={styles.row}>
          <Text className={styles.rowBody}>{participantNames[id] || id}</Text><Text className={styles.link}
            onClick={() => !busy && update('participant_ids', form.participant_ids?.filter(value => value !== id))}>移除</Text>
        </View>)}
      </View>
      <View className={styles.section}><Text className={styles.heading}>预定规则</Text>
        {([
          ['prepayment_percent', '预付款比例（0–100%）'], ['full_refund_cancel_lead_days', '全额退款提前天数（0–10）'],
          ['booking_lead_hours', '最少提前小时（0–168）'], ['booking_future_open_days', '开放预定天数（7–180）'],
        ] as Array<[keyof Form, string]>).map(([key, label]) => <View key={key} className={styles.field}><Text className={styles.label}>{label}</Text>
          <Input className={styles.input} type="digit" value={String(form[key] ?? '')} onInput={event => update(key, Number(event.detail.value))} /></View>)}
        <View className={styles.row}><Text className={styles.rowBody}>付款后自动接单</Text><Switch checked={form.auto_accept_after_payment}
          color="#E0115F" onChange={event => update('auto_accept_after_payment', event.detail.value)} /></View>
        <Text className={styles.label}>可预约时段（未设置为全天）</Text>
        <View className={styles.search}><Picker mode="time" value={rangeStart} onChange={event => setRangeStart(event.detail.value)}><View className={styles.picker}>{rangeStart}</View></Picker>
          <Text>至</Text><Picker mode="time" value={rangeEnd} onChange={event => setRangeEnd(event.detail.value)}><View className={styles.picker}>{rangeEnd}</View></Picker></View>
        <View className={styles.actions}><View><ActionButton small outline onClick={() => {
          if (rangeStart >= rangeEnd) { void Taro.showToast({ title: '结束时间应晚于开始时间', icon: 'none' }); return; }
          const current = decodeRanges(form.booking_time_ranges_json || '');
          if (current.some(range => range.start === rangeStart && range.end === rangeEnd)) return;
          update('booking_time_ranges_json', JSON.stringify([...current, { start: rangeStart, end: rangeEnd }].sort((a, b) => a.start.localeCompare(b.start))));
        }}>添加时段</ActionButton></View><View><ActionButton small outline onClick={() => update('booking_time_ranges_json', '')}>重置全天</ActionButton></View></View>
        {decodeRanges(form.booking_time_ranges_json || '').map((range, index) => <View className={styles.row} key={`${range.start}-${range.end}`}>
          <Text className={styles.rowBody}>{range.start} 至 {range.end}</Text>
          <Text className={styles.link} onClick={() => update('booking_time_ranges_json', JSON.stringify(
            decodeRanges(form.booking_time_ranges_json || '').filter((_, i) => i !== index)))}>删除</Text>
        </View>)}
        {!decodeRanges(form.booking_time_ranges_json || '').length && <Text className={styles.muted}>全天可预约</Text>}
      </View>
      <View className={styles.section}><Text className={styles.heading}>服务特点</Text><Tags values={options.features} selected={form.service_feature_tags}
        onToggle={value => update('service_feature_tags', form.service_feature_tags?.includes(value) ? form.service_feature_tags.filter(tag => tag !== value) : [...(form.service_feature_tags || []), value])} /></View>
      <View className={styles.section}><Text className={styles.heading}>额外费用</Text><Tags values={options.fees} selected={form.service_extra_fee_tags}
        onToggle={value => update('service_extra_fee_tags', form.service_extra_fee_tags?.includes(value) ? form.service_extra_fee_tags.filter(tag => tag !== value) : [...(form.service_extra_fee_tags || []), value])} /></View>
      <View className={styles.section}><Text className={styles.heading}>服务声明</Text>{DECLARATIONS.map(line => <Text key={line} className={styles.subtitle}>{line}</Text>)}
        <Textarea className={styles.textarea} value={declarationsText} placeholder="补充声明，每行一条" maxlength={5000}
          onInput={event => setDeclarationsText(event.detail.value)} /></View>
    </> : <View className={styles.section}>
      {([['price_text', '价格'], ['price_basis_text', '计价说明'], ['duration_text', '时长'], ['badge_text', '封面标签']] as Array<[keyof Form, string]>)
        .map(([key, label]) => <View key={key} className={styles.field}><Text className={styles.label}>{label}</Text><Input className={styles.input}
          value={String(form[key] || '')} onInput={event => update(key, event.detail.value)} /></View>)}
      <View className={styles.field}><Text className={styles.label}>体验标签（逗号分隔）</Text><Input className={styles.input} value={tagsText}
        onInput={event => setTagsText(event.detail.value)} /></View>
      <Text className={styles.heading}>行程步骤</Text>{(form.detail_steps || []).map((step, index) => <View key={index} className={styles.section}>
        <Input className={styles.input} value={step.title} placeholder={`步骤${index + 1}标题`} onInput={event => setStep(index, { title: event.detail.value })} />
        <Textarea className={styles.textarea} value={step.description} placeholder="步骤说明" maxlength={5000} onInput={event => setStep(index, { description: event.detail.value })} />
        <View className={styles.photos}>{step.image_urls.map((url, imageIndex) => <View key={`${url}-${imageIndex}`} className={styles.photo}>
          <Image className={styles.photoImage} src={mediaUrl(url)} mode="aspectFill" onError={() => console.error('[Publish] Step image failed')} />
          <Text className={styles.remove} onClick={() => !busy && setStep(index, { image_urls: step.image_urls.filter((_, i) => i !== imageIndex) })}>×</Text>
        </View>)}
          {step.image_urls.length < 9 && <View className={classnames(styles.photo, styles.addPhoto)} onClick={() => void addStepImages(index)}>+</View>}
        </View>
        <Text className={styles.link} onClick={() => !busy && update('detail_steps', form.detail_steps?.filter((_, i) => i !== index))}>删除步骤</Text>
      </View>)}
      <ActionButton small outline onClick={() => update('detail_steps', [...(form.detail_steps || []), { title: '', description: '', image_urls: [] }])}>添加步骤</ActionButton>
    </View>}
    <View className={styles.notice}>提交后进入审核，通过后才会公开展示。</View><View className={styles.spacer} />
    <View className={styles.bottom}><View><ActionButton outline disabled={busy} onClick={() => void submit(true)}>存草稿</ActionButton></View>
      <View><ActionButton loading={busy} onClick={() => void submit(false)}>提交审核</ActionButton></View></View>
  </View>;
}
