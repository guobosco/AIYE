export interface PriceTier { name: string; price: string; duration_amount: number; duration_unit: string }
const PREFIX = 'lulu_publish_tiers_v2:';
export const normalizeDurationUnit = (unit: string) => unit.trim() === '分钟' ? '分钟' : '小时';
const durationAmount = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 1 ? Math.min(99999, Math.floor(amount)) : 4;
};
export const decodePriceTiers = (price: string, basis: string): PriceTier[] => {
  const source = (basis || '').trim();
  if (/^lulu_publish_tiers_v[12]:/.test(source)) {
    try {
      const value = JSON.parse(source.slice(source.indexOf(':') + 1)) as {
        tiers: Array<Partial<PriceTier> & { duration?: string }>;
      };
      if (Array.isArray(value.tiers) && value.tiers.length) return value.tiers.map(tier => ({
        name: tier.name?.trim() || '', price: tier.price?.trim() || price,
        duration_amount: durationAmount(tier.duration_amount || tier.duration?.match(/\d+/)?.[0] || 4),
        duration_unit: tier.duration_unit === '分钟' || tier.duration?.includes('分钟') ? '分钟' : '小时',
      }));
    } catch { console.error('[Price] Invalid tier data'); }
  }
  return [{ name: '', price: price || '面议', duration_amount: durationAmount(source.match(/\d+/)?.[0] || 4), duration_unit: source.includes('分钟') ? '分钟' : '小时' }];
};
export const encodePriceTiers = (tiers: PriceTier[]) => {
  if (!tiers.length || tiers.some(tier => !Number.isInteger(tier.duration_amount) || tier.duration_amount < 1 || tier.duration_amount > 99999
    || !/^[¥￥]?\s*\d+(\.\d{1,2})?$/.test(tier.price.trim())
    || !Number.isFinite(Number(tier.price.replace(/[¥￥\s]/g, ''))) || Number(tier.price.replace(/[¥￥\s]/g, '')) <= 0)) {
    throw new Error('请填写有效价格和时长');
  }
  const normalized = tiers.map(tier => ({ ...tier, name: tier.name.trim(), price: tier.price.trim(),
    duration_unit: normalizeDurationUnit(tier.duration_unit) }));
  return {
    price_text: normalized.length === 1 ? `${normalized[0].price} · ${normalized[0].duration_amount}${normalized[0].duration_unit}${normalized[0].name ? ` · ${normalized[0].name}` : ''}`
      : `¥${Math.min(...normalized.map(tier => Number(tier.price.replace(/[^\d.]/g, ''))))}起 · ${normalized.length}档`,
    price_basis_text: PREFIX + JSON.stringify({ tiers: normalized }),
    service_mode: normalized[0].duration_unit,
  };
};
export const priceBasisLabel = (basis: string, mode = '') => /^lulu_publish_tiers_v[12]:/.test((basis || '').trim()) ? mode.trim() || '以档位说明为准' : basis;
