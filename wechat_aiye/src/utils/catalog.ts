import type { CatalogItem, Experience, ItemKind, Service } from '@/types/models';

export const SERVICE_CATEGORIES = ['地陪', '摄影', 'DJ气氛组', '运动教练', '私厨', '化妆', '技能教学', '其他服务'];
export const EXPERIENCE_CATEGORIES = ['必游经典景区', '潜水冲浪跳伞', '海面运动', '文化探索', '夜生活', '其他体验'];
export const DECLARATIONS = [
  '发布内容需真实、准确，不得虚假宣传。',
  '价格与费用说明需清晰透明，额外收费需提前告知。',
  '服务过程中需尊重用户隐私与人身安全。',
  '涉及行程、接待或上门服务时需按约履约。',
];
export const FEATURE_TAGS = ['新手友好', '亲子友好', '情侣适合', '团建适合', '可上门', '到店服务', '线上沟通',
  '可定制', '夜间友好', '英文沟通', '一对一', '会引导', '路线熟悉', '当日返图', '可修图', '情绪价值', '控场互动', '忌口可调'];
export const EXTRA_FEE_TAGS = ['交通费', '门票费', '场地费', '食材费', '设备租赁', '超时费用', '节假日加价'];
export const normalizeServiceCategory = (raw?: string) => {
  const value = raw?.trim() || '';
  return [...SERVICE_CATEGORIES, ...EXPERIENCE_CATEGORIES.filter(name => name !== '其他体验')].includes(value)
    ? value : '其他服务';
};
export const categoryOf = (item: CatalogItem, kind: ItemKind) => {
  const value = item.category?.trim();
  if (kind === 'experience') return value || '其他体验';
  return normalizeServiceCategory(value);
};
export const displayLocation = (raw?: string) => (raw || '').split('|||PEIPEI_GEO1|||')[0].trim();
export const cityLocation = (raw: string) => {
  const source = displayLocation(raw);
  const normalized = source.replace(/[\s/|·,，]+/g, '');
  const province = normalized.match(/^(.+?(?:省|自治区|特别行政区))(.+?(?:市|自治州|盟))/);
  if (province) return `${province[1]}${province[2]}`;
  return normalized.match(/^(北京市|上海市|天津市|重庆市)/)?.[1]
    || normalized.match(/^(.+?市)/)?.[1] || source || '地点待沟通';
};
export const ratingText = (rating?: number) => rating && rating > 0 ? `★ ${rating.toFixed(2)}分` : '';
export const homeMeta = (item: CatalogItem) =>
  [cityLocation(item.location), ratingText(item.average_rating)].filter(Boolean).join('  ');
export const homeServiceCoverHeight = (id: string) => {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (Math.imul(hash, 31) + id.charCodeAt(index)) | 0;
  return [336, 384, 432, 476][Math.abs(hash) % 4];
};
export const experienceSections = (items: Experience[]): [string, Experience[]][] => {
  const groups = new Map<string, Experience[]>();
  [...items].sort((a, b) => b.updated_at - a.updated_at || b.created_at - a.created_at).forEach(item => {
    const category = categoryOf(item, 'experience');
    groups.set(category, [...(groups.get(category) || []), item]);
  });
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
};
export const sortCatalog = <T extends CatalogItem>(items: T[]): T[] => [...items].sort((a, b) =>
  (b.sort_priority || 0) - (a.sort_priority || 0)
  || Number(Boolean(b.is_important)) - Number(Boolean(a.is_important))
  || b.updated_at - a.updated_at);
export const hostOf = (item: Service | Experience, kind: ItemKind) => kind === 'service'
  ? { id: (item as Service).creator_id, name: (item as Service).creator }
  : { id: (item as Experience).host_id, name: (item as Experience).host_name };
export const itemUrl = (kind: ItemKind, id: string) =>
  `/pages/${kind === 'service' ? 'service-detail' : 'experience-detail'}/index?id=${encodeURIComponent(id)}`;
export const formatTime = (timestamp: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
};
export const uniqueId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
export const splitLines = (value: string) => [...new Set(value.split(/[\n,，]/).map(text => text.trim()).filter(Boolean))];
export const reviewLabel = (item: CatalogItem) => {
  if ('is_draft' in item && item.is_draft) return '草稿';
  return ({ pending_review: '待审核', approved: '已通过', rejected: '未通过', draft: '草稿' } as Record<string, string>)[item.review_status || 'approved'] || '待审核';
};
