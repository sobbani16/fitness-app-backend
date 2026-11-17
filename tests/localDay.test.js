const ld = require('../src/services/localDay');

const CLT = 'America/New_York'; // Charlotte (UTC-5/-4)
const DAL = 'America/Chicago'; // Dallas (UTC-6/-5)

describe('localDay infrastructure', () => {
  test('zone validation: IANA only, never abbreviations', () => {
    expect(ld.isValidZone('America/New_York')).toBe(true);
    expect(ld.isValidZone('Asia/Kolkata')).toBe(true);
    expect(ld.isValidZone('UTC')).toBe(true);
    expect(ld.isValidZone('EST')).toBe(false);
    expect(ld.isValidZone('CST')).toBe(false);
    expect(ld.isValidZone('UTC-5')).toBe(false);
    expect(ld.isValidZone('nonsense')).toBe(false);
    expect(ld.isValidZone(null)).toBe(false);
  });

  test('dayKey: same UTC instant, different local days across zones', () => {
    const instant = '2026-11-17T02:00:00Z'; // 9 PM Mon Charlotte, 8 PM Mon Dallas
    expect(ld.dayKey(instant, CLT)).toBe('2026-11-16');
    expect(ld.dayKey(instant, DAL)).toBe('2026-11-16');
    const late = '2026-11-17T05:30:00Z'; // 00:30 Charlotte Tue, 23:30 Dallas Mon
    expect(ld.dayKey(late, CLT)).toBe('2026-11-17');
    expect(ld.dayKey(late, DAL)).toBe('2026-11-16');
  });

  test('Charlotte→Dallas travel: lunch 12:30 local stays 12:30 local', () => {
    const lunch = ld.parseHHMM('12:30');
    const cltUtc = ld.wallTimeToUtc('2026-11-17', lunch, CLT);
    const dalUtc = ld.wallTimeToUtc('2026-11-17', lunch, DAL);
    expect(ld.localParts(cltUtc, CLT).minutes).toBe(750);
    expect(ld.localParts(dalUtc, DAL).minutes).toBe(750);
    expect(dalUtc.getTime() - cltUtc.getTime()).toBe(3600000); // one hour later in UTC, same local wall time
  });

  test('day boundaries differ by zone but never by server tz', () => {
    const { startUtc: a } = ld.dayRangeUtc('2026-11-17', CLT);
    const { startUtc: b } = ld.dayRangeUtc('2026-11-17', 'Asia/Kolkata');
    expect(Math.abs(a - b)).toBeGreaterThan(0);
    process.env.TZ = 'Pacific/Kiritimati'; // must not leak into computations
    expect(ld.dayRangeUtc('2026-11-17', CLT).startUtc.getTime()).toBe(a.getTime());
    delete process.env.TZ;
  });

  test('12h ↔ 24h conversion incl. noon/midnight edge cases', () => {
    expect(ld.to24h('8:00 AM')).toBe('08:00');
    expect(ld.to24h('12:30 PM')).toBe('12:30');
    expect(ld.to24h('7:30 PM')).toBe('19:30');
    expect(ld.to24h('12:00 AM')).toBe('00:00'); // midnight
    expect(ld.to24h('12:00 PM')).toBe('12:00'); // noon
    expect(ld.to24h({ hour: 11, minute: 45, period: 'PM' })).toBe('23:45');
    expect(ld.to24h({ hour: 12, minute: 0, period: 'AM' })).toBe('00:00');
    expect(ld.to24h('25:99')).toBe(null);
    expect(ld.to12h('19:30').display).toBe('7:30 PM');
    expect(ld.to12h('00:00').display).toBe('12:00 AM');
    expect(ld.to12h('12:00').display).toBe('12:00 PM');
  });

  test('overnight sleep attributes to the wake day, not the start day', () => {
    expect(ld.sleepAttributionDay('2026-11-17T11:30:00Z', CLT)).toBe('2026-11-17'); // woke 6:30 AM local
    const { startUtc, endUtc } = ld.lastNightRangeUtc('2026-11-17', CLT);
    expect(ld.dayKey(startUtc, CLT)).toBe('2026-11-16'); // window starts previous local noon
    expect(endUtc.getTime()).toBeGreaterThan(startUtc.getTime());
  });

  test('DST spring forward: nonexistent 2:30 AM lands deterministically', () => {
    const t = ld.wallTimeToUtc('2026-03-08', 150, CLT); // 2:30 AM doesn't exist
    const back = ld.localParts(t, CLT);
    expect([150, 180].includes(back.minutes) || back.minutes > 120).toBe(true); // converges, no throw
  });
});
