const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatDateInTimeZone,
  formatMessageTimestamp,
  formatTimestamp,
  parseDateFormat,
  parseTimeZonePreference,
} = require('../dist/main/shared/date-time.js');

const UTC_INSTANT = Date.UTC(2026, 0, 16, 22, 30);

test('formats the same UTC instant in the selected time zone', () => {
  const boise = parseTimeZonePreference('America/Boise');
  const shanghai = parseTimeZonePreference('Asia/Shanghai');

  assert.equal(formatTimestamp(UTC_INSTANT, 'iso', boise), '2026-01-16 15:30');
  assert.equal(formatTimestamp(UTC_INSTANT, 'iso', shanghai), '2026-01-17 06:30');
});

test('supports every General date and time format', () => {
  const timeZone = parseTimeZonePreference('America/Boise');

  assert.equal(formatTimestamp(UTC_INSTANT, 'us', timeZone), '01/16/2026 3:30 PM');
  assert.equal(formatTimestamp(UTC_INSTANT, 'uk', timeZone), '16/01/2026 15:30');
  assert.equal(formatTimestamp(UTC_INSTANT, 'de', timeZone), '16.01.2026 15:30');
  assert.equal(formatTimestamp(UTC_INSTANT, 'cn', timeZone), '2026年01月16日 15:30');
});

test('labels message timestamps from today in the selected time zone', () => {
  const boise = parseTimeZonePreference('America/Boise');
  const now = Date.UTC(2026, 0, 17, 3, 0);

  assert.equal(formatMessageTimestamp(UTC_INSTANT, 'iso', boise, now), 'Today 15:30');
  assert.equal(formatMessageTimestamp(UTC_INSTANT, 'us', boise, now), 'Today 3:30 PM');
});

test('uses the selected format for older message timestamps', () => {
  const boise = parseTimeZonePreference('America/Boise');
  const nextDay = Date.UTC(2026, 0, 18, 8, 0);

  assert.equal(formatMessageTimestamp(UTC_INSTANT, 'de', boise, nextDay), '16.01.2026 15:30');
});

test('falls back safely for invalid persisted settings', () => {
  assert.equal(parseDateFormat('unexpected'), 'iso');
  assert.deepEqual(parseTimeZonePreference('Mars/Olympus_Mons'), { kind: 'system' });
});

test('formats the dynamic prompt date in the selected time zone', () => {
  const shanghai = parseTimeZonePreference('Asia/Shanghai');
  assert.equal(formatDateInTimeZone(UTC_INSTANT, shanghai), '2026-01-17');
});
