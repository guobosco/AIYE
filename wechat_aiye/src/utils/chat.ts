import type { ChatMessage, ItemKind } from '@/types/models';

export const compareChatMessages = (a: ChatMessage, b: ChatMessage) =>
  a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface InquiryContext {
  kind?: ItemKind;
  id?: string;
  title?: string;
  date?: string;
  createdAt?: number;
  hostProfile?: boolean;
}

export const chatInquiryMeta = (messages: ChatMessage[], context: InquiryContext) => {
  const linked = context.hostProfile ? undefined : messages.find(message => context.id
    ? message.extra?.[`${context.kind}_id`] === context.id
    : !!(message.extra?.service_id || message.extra?.experience_id));
  const kind = context.hostProfile ? undefined : context.kind
    || (linked?.extra.experience_id ? 'experience' : linked?.extra.service_id ? 'service' : undefined);
  const id = context.hostProfile ? '' : context.id || (kind && linked?.extra[`${kind}_id`]) || '';
  const title = context.title?.trim() || linked?.extra.title?.trim() || '';
  const dated = kind && id ? messages.find(message => message.extra?.[`${kind}_id`] === id
    && (message.extra.inquiry_date?.trim() || (message.extra.start_date?.trim() && message.extra.end_date?.trim()))) : undefined;
  const range = dated?.extra.start_date?.trim() && dated?.extra.end_date?.trim()
    ? `${dated.extra.start_date.trim()}至${dated.extra.end_date.trim()}` : '';
  let date = context.date?.trim() || dated?.extra.inquiry_date?.trim() || range;
  if (!date && context.createdAt && Number.isFinite(context.createdAt) && context.createdAt > 0) {
    const created = new Date(context.createdAt);
    if (Number.isFinite(created.getTime())) date = `${created.getFullYear()}年${created.getMonth() + 1}月${created.getDate()}日`;
  }
  const label = kind === 'experience' ? '体验' : '服务';
  const listingTitle = title ? (title.endsWith(label) ? title : `${title}${label}`) : label;
  const summary = context.hostProfile || (!id && !date) ? '' : `关于${date || ''}${listingTitle}的咨询`;
  return { kind, id, title, date: date || '', summary };
};
