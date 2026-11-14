export interface PublicationOptions { features: string[]; fees: string[] }
export interface PublicationHints {
  titlePlaceholder: string;
  descriptionPlaceholder: string;
  categoryTip?: string;
}
const HINTS: Record<string, PublicationHints> = {
  '地陪': {
    titlePlaceholder: '例如：亚龙湾一日地陪｜含路线规划',
    descriptionPlaceholder: '写清服务城市、陪同时间、是否含路线规划与门票建议，以及适合的人群。',
    categoryTip: '地陪类建议标明集合地点、可预约时段和服务人数。',
  },
  '摄影': {
    titlePlaceholder: '例如：三亚海边旅拍｜精修 9 张',
    descriptionPlaceholder: '写清拍摄场景、时长、交付张数、修图周期和是否支持加急。',
    categoryTip: '摄影类建议写明设备档位、精修数量和返图时效。',
  },
  'DJ气氛组': {
    titlePlaceholder: '例如：沙滩派对 DJ 暖场｜双人配置',
    descriptionPlaceholder: '介绍曲风、活动类型、人员分工、设备情况以及可承接时长。',
    categoryTip: '活动氛围类建议补充设备、主持或互动内容。',
  },
  '运动教练': {
    titlePlaceholder: '例如：晨间燃脂私教｜适合新手',
    descriptionPlaceholder: '写清训练目标、课时长度、地点、适合人群和所需器材。',
    categoryTip: '教练类可标明认证背景和擅长方向。',
  },
  '私厨': {
    titlePlaceholder: '例如：4 人海鲜家宴｜到家现做',
    descriptionPlaceholder: '说明菜系、份量、是否含采购、忌口处理和餐后清洁范围。',
    categoryTip: '私厨类建议写明人数、菜单风格和是否含食材费。',
  },
  '化妆': {
    titlePlaceholder: '例如：婚礼跟妆｜含试妆一次',
    descriptionPlaceholder: '写清妆容风格、服务时长、是否含饰品与上门区域。',
    categoryTip: '妆造类建议说明是否含补妆与跟场时长。',
  },
  '技能教学': {
    titlePlaceholder: '例如：潜水入门理论课｜1 对 1 陪练',
    descriptionPlaceholder: '说明教学方向、单次时长、适合基础以及课后支持内容。',
    categoryTip: '教学类建议标注课程目标、适合人群与器材要求。',
  },
  '其他服务': {
    titlePlaceholder: '用一句话概括你的服务',
    descriptionPlaceholder: '详细介绍服务内容、流程和亮点，帮助用户快速了解并下单。',
  },
};
export const publicationHints = (category?: string): PublicationHints =>
  HINTS[category || '其他服务'] || HINTS['其他服务'];
const OPTIONS: Record<string, PublicationOptions> = {
  '地陪': {
    features: ['情绪价值', '纯绿', '可拉手', '熟悉路线', '会安排行程', '会拍照', '会聊天', '英语沟通'],
    fees: ['油费', '打车费', '门票', '游玩过程产生的费用', '停车费', '跨区费', '餐饮AA', '超时费'],
  },
  '摄影': {
    features: ['审美在线', '会引导动作', '可修图', '当日返图', '底片全送', '情侣拍摄', '闺蜜拍摄', '夜景擅长'],
    fees: ['门票', '场地费', '交通费', '服装道具费', '妆造费', '加急修图费', '超时费', '异地差旅费'],
  },
  'DJ气氛组': {
    features: ['氛围带动', '可控场', '会暖场互动', '自带设备', '曲风可定制', '会喊麦', '派对经验', '婚礼经验'],
    fees: ['设备运输费', '搭建费', '场地费', '灯光设备费', '打车费', '超时费', '异地差旅费', '住宿费'],
  },
  '运动教练': {
    features: ['纠正动作', '减脂塑形', '增肌力量', '体态改善', '饮食建议', '新手友好', '一对一', '可上门'],
    fees: ['场地费', '器械费', '打车费', '停车费', '异地上门费', '超时费', '课程资料费'],
  },
  '私厨': {
    features: ['会买菜', '可定制菜单', '摆盘好看', '忌口可调', '可做家宴', '可做轻食', '厨房整理', '上门制作'],
    fees: ['食材费', '打车费', '停车费', '厨具耗材费', '场地清洁费', '节假日加价', '超时费'],
  },
  '化妆': {
    features: ['自然妆感', '韩系', '新娘跟妆', '可试妆', '假睫毛含', '可上门', '男士妆发', '证件照妆'],
    fees: ['上门费', '打车费', '假发饰品费', '试妆费', '节假日加价', '超时费', '早妆费'],
  },
  '技能教学': {
    features: ['耐心细致', '零基础友好', '课后答疑', '一对一', '可上门', '可线上', '系统训练', '可陪练'],
    fees: ['教材费', '场地费', '设备耗材费', '打车费', '停车费', '超时费', '考试报名费'],
  },
  '其他服务': {
    features: ['沟通顺畅', '时间灵活', '可上门', '可定制', '新手友好', '长期可约'],
    fees: ['交通费', '场地费', '材料费', '超时费', '异地差旅费', '节假日加价'],
  },
};
export const publicationOptions = (category?: string): PublicationOptions =>
  OPTIONS[category || '其他服务'] || OPTIONS['其他服务'];
export const normalizePublicationTags = (selected: string[], available: string[]) =>
  available.filter(value => selected.includes(value));
export const movePublicationImage = (images: string[], from: number, to: number): string[] => {
  const result = [...images];
  if (!Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
  const [image] = result.splice(from, 1);
  result.splice(to, 0, image);
  return result;
};
