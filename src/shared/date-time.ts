export const DATE_FORMAT_VALUES = ['iso', 'us', 'uk', 'de', 'cn'] as const;

export type DateFormat = typeof DATE_FORMAT_VALUES[number];

type IanaTimeZone = string & { readonly __brand: 'IanaTimeZone' };

export type TimeZonePreference =
  | { kind: 'system' }
  | { kind: 'iana'; value: IanaTimeZone };

interface DateTimeParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  dayPeriod: string;
}

export function parseDateFormat(raw: string | null | undefined): DateFormat {
  return DATE_FORMAT_VALUES.find(format => format === raw) ?? 'iso';
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function parseTimeZonePreference(raw: string | null | undefined): TimeZonePreference {
  if (!raw || raw === 'system' || !isValidTimeZone(raw)) return { kind: 'system' };
  return { kind: 'iana', value: raw as IanaTimeZone };
}

export function serializeTimeZonePreference(preference: TimeZonePreference): string {
  return preference.kind === 'system' ? 'system' : preference.value;
}

export function resolveTimeZone(preference: TimeZonePreference): string {
  if (preference.kind === 'iana') return preference.value;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function getDateTimeParts(
  timestamp: number,
  preference: TimeZonePreference,
  hour12: boolean,
): DateTimeParts | null {
  if (!Number.isFinite(timestamp)) return null;

  const formatter = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone: resolveTimeZone(preference),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    ...(hour12 ? { hour12: true } : { hourCycle: 'h23' as const }),
  });
  const values = new Map(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));

  return {
    year: values.get('year') ?? '',
    month: values.get('month') ?? '',
    day: values.get('day') ?? '',
    hour: values.get('hour') ?? '',
    minute: values.get('minute') ?? '',
    dayPeriod: values.get('dayPeriod') ?? '',
  };
}

export function formatTimestamp(
  timestamp: number,
  format: DateFormat,
  preference: TimeZonePreference,
): string {
  const parts = getDateTimeParts(timestamp, preference, format === 'us');
  if (!parts) return '';

  switch (format) {
    case 'us':
      return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
    case 'uk':
      return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
    case 'de':
      return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
    case 'cn':
      return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`;
    case 'iso':
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }
}

export function formatMessageTimestamp(
  timestamp: number,
  format: DateFormat,
  preference: TimeZonePreference,
  now: number = Date.now(),
): string {
  const parts = getDateTimeParts(timestamp, preference, format === 'us');
  if (!parts) return '';

  const messageDate = `${parts.year}-${parts.month}-${parts.day}`;
  const today = formatDateInTimeZone(now, preference);
  if (messageDate !== today) return formatTimestamp(timestamp, format, preference);

  const time = format === 'us'
    ? `${parts.hour}:${parts.minute} ${parts.dayPeriod}`
    : `${parts.hour}:${parts.minute}`;
  return `Today ${time}`;
}

export function formatDateInTimeZone(timestamp: number, preference: TimeZonePreference): string {
  const parts = getDateTimeParts(timestamp, preference, false);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getSupportedTimeZones(): string[] {
  const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const supportedValuesOf: unknown = Reflect.get(Intl, 'supportedValuesOf');
  let supported: string[] = [];

  if (typeof supportedValuesOf === 'function') {
    const values: unknown = Reflect.apply(supportedValuesOf, Intl, ['timeZone']);
    if (Array.isArray(values)) {
      supported = values.filter(value => typeof value === 'string');
    }
  }

  return [...new Set(['UTC', systemTimeZone, ...supported])].sort((a, b) => a.localeCompare(b));
}
