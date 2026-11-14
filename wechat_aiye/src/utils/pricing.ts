export interface PriceTier { name: string; price: string; duration_amount: number; duration_unit: string }
const PREFIX = 'lulu_publish_tiers_v2:';
const durationAmount = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 1 ? Math.min(99999, Math.floor(amount)) : 4;
};
export const decodePriceTiers = (price: string, basis: string): PriceTier[] => {
  const source = basis || '';
  if (/^lulu_publish_tiers_v[12]:/.test(source)) {
    try {
      const value = JSON.parse(source.slice(source.indexOf(':') + 1)) as {
        tiers: Array<Partial<PriceTier> & { duration?: string }>;
      };
      if (Array.isArray(value.tiers) && value.tiers.length) return value.tiers.map((tier, index) => ({
        name: tier.name || `档位${index + 1}`, price: tier.price || price,
        duration_amount: durationAmount(tier.duration_amount || tier.duration?.match(/\d+/)?.[0] || 4),
        duration_unit: tier.duration_unit === '分钟' || tier.duration?.includes('分钟') ? '分钟' : '小时',
      }));
    } catch { console.error('[Price] Invalid tier data'); }
  }
  return [{ name: '标准服务', price: price || '面议', duration_amount: durationAmount(source.match(/\d+/)?.[0] || 4), duration_unit: source.includes('分钟') ? '分钟' : '小时' }];
};
export const encodePriceTiers = (tiers: PriceTier[]) => {
  if (!tiers.length || tiers.some(tier => !Number.isFinite(tier.duration_amount) || tier.duration_amount < 1
    || !/^[¥￥]?\s*\d+(\.\d{1,2})?$/.test(tier.price) || Number(tier.price.replace(/[¥￥\s]/g, '')) <= 0)) {
    throw new Error('请填写有效价格和时长');
  }
  return {
    price_text: tiers.length === 1 ? `${tiers[0].price} · ${tiers[0].duration_amount}${tiers[0].duration_unit}${tiers[0].name ? ` · ${tiers[0].name}` : ''}`
      : `¥${Math.min(...tiers.map(tier => Number(tier.price.replace(/[^\d.]/g, ''))))}起 · ${tiers.length}档`,
    price_basis_text: PREFIX + JSON.stringify({ tiers }),
  };
};
export const priceBasisLabel = (basis: string, mode = '') => /^lulu_publish_tiers_v[12]:/.test(basis || '') ? mode || '以档位说明为准' : basis;
