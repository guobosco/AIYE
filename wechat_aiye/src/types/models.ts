export type ItemKind = 'service' | 'experience';
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}
export interface AuthResponse extends TokenResponse {
  user: User;
  need_bind_phone: boolean;
  is_new_user: boolean;
}
export interface DetailStep {
  title: string;
  description: string;
  image_urls: string[];
}
export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  cover_image_url: string;
  image_urls: string[];
  location: string;
  price_text: string;
  price_basis_text: string;
  category: string;
  created_at: number;
  updated_at: number;
  is_deleted: boolean;
  review_status?: string;
  review_note?: string;
  average_rating?: number;
  sort_priority?: number;
  is_important?: boolean;
}
export interface Service extends CatalogItem {
  creator: string;
  creator_id: string;
  is_draft: boolean;
  service_mode: string;
  service_time: number;
  prepayment_percent: number;
  full_refund_cancel_lead_days: number;
  booking_time_ranges_json: string;
  booking_lead_hours: number;
  booking_future_open_days: number;
  auto_accept_after_payment: boolean;
  sync_to_square: boolean;
  participant_ids: string[];
  service_declarations_extra: string[];
  service_feature_tags: string[];
  service_extra_fee_tags: string[];
}
export interface Experience extends CatalogItem {
  host_id: string;
  host_name: string;
  duration_text: string;
  badge_text: string;
  tags: string[];
  detail_steps: DetailStep[];
}
export interface User {
  id: string;
  name: string;
  email?: string;
  photo_url: string;
  profile_image_urls: string[];
  pei_pei_id: string;
  phone_number?: string;
  is_phone_verified: boolean;
  is_profile_completed: boolean;
  signature: string;
  gender: string;
  region: string;
  tags: string[];
  job_title: string;
  education: string;
  birth_decade: string;
  height_cm: number;
  weight_kg: number;
  height_weight_private: boolean;
  middle_school_favorite_song: string;
  spoken_languages: string[];
  living_city: string;
  living_country: string;
  identity_verified: boolean;
  review_count: number;
  average_rating: number;
  service_years: number;
  review_summaries: string[];
  address_detail?: string;
  address_recipient_name?: string;
  address_phone_number?: string;
  created_at: number;
  updated_at: number;
}
export interface WishlistGroup {
  name: string;
  service_ids: string[];
}
export interface WishlistProfile {
  service_ids: string[];
  groups: WishlistGroup[];
}
export interface Conversation {
  id: string;
  type: string;
  title: string;
  avatar_url: string;
  participant_ids: string[];
  last_message_preview: string;
  last_message_at: number;
  created_at?: number;
}
export interface ConversationItem {
  conversation: Conversation;
  member?: { unread_count: number; is_muted: boolean };
  peer?: User;
}
export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: string;
  content: string;
  attachment_url: string;
  attachment_name: string;
  attachment_size: number;
  object_key: string;
  extra: Record<string, string>;
  client_message_id?: string;
  status: string;
  created_at: number;
  is_deleted: boolean;
}
export interface MessageInput {
  type: string;
  content?: string;
  attachment_url?: string;
  attachment_name?: string;
  attachment_size?: number;
  object_key?: string;
  extra?: Record<string, string>;
  client_message_id?: string;
}
export interface UploadResult {
  url: string;
  object_key?: string;
}
export interface ActivityRecord {
  id: string;
  item_id: string;
  kind: ItemKind;
  title: string;
  cover_image_url: string;
  location: string;
  price_text: string;
  category: string;
  host_id: string;
  host_name: string;
  recorded_at: number;
  scheduled_at?: number;
  status?: 'inquiry' | 'cancelled';
  conversation_id?: string;
}
export interface CalendarClosure {
  allDay: boolean;
  start: string;
  end: string;
}
