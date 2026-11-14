import type { CalendarClosure, Service } from '@/types/models';
export interface TimeRange { start: string; end: string }
export interface BookingDay { key: string; label: string; times: string[] }
export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const clockMinutes = (clock: string) => {
  if (clock === '24:00') return 1440;
  if (!/^\d{2}:\d{2}$/.test(clock)) return NaN;
  const [h, m] = clock.split(':').map(Number);
  return h <= 23 && m <= 59 ? h * 60 + m : NaN;
};
export const decodeRanges = (raw: string): TimeRange[] => {
  if (!raw.trim()) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((item: unknown): item is TimeRange =>
      typeof item === 'object' && item !== null && 'start' in item && 'end' in item
      && typeof item.start === 'string' && typeof item.end === 'string'
      && clockMinutes(item.start) < clockMinutes(item.end));
  } catch (error) { console.error('[Booking] Invalid time ranges'); return []; }
};
export const bookingDays = (
  service: Pick<Service, 'booking_time_ranges_json' | 'booking_lead_hours' | 'booking_future_open_days'>,
  now = new Date(), closures: Record<string, CalendarClosure> = {},
): BookingDay[] => {
  const count = Math.max(7, Math.min(180, service.booking_future_open_days || 30));
  const earliest = now.getTime() + Math.max(0, service.booking_lead_hours || 0) * 3600000;
  const decoded = decodeRanges(service.booking_time_ranges_json || '');
  const ranges = decoded.length ? decoded : [{ start: '00:00', end: '24:00' }];
  const times = Array.from({ length: 48 }, (_, index) =>
    `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`)
    .filter(time => ranges.some(range => clockMinutes(time) >= clockMinutes(range.start) && clockMinutes(time) < clockMinutes(range.end)));
  return Array.from({ length: count }, (_, offset) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const key = dateKey(day);
    const closure = closures[key];
    return {
      key, label: offset === 0 ? '今天' : offset === 1 ? '明天' : `${day.getMonth() + 1}月${day.getDate()}日`,
      times: times.filter(time => {
        if (closure?.allDay) return false;
        const minute = clockMinutes(time);
        if (closure && minute >= clockMinutes(closure.start) && minute < clockMinutes(closure.end)) return false;
        return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minute / 60), minute % 60).getTime() >= earliest;
      }),
    };
  }).filter(day => day.times.length);
};
export const scheduledMillis = (key: string, time: string) => {
  const [year, month, day] = key.split('-').map(Number);
  const minutes = clockMinutes(time);
  return new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60).getTime();
};
