const { search, parseDuration, formatDuration, score, trustedChannels, _cache } = require('../src/services/youtubeService');

const env = { YOUTUBE_TRUSTED_CHANNELS: 'Trusted Coach|UC_trusted1' };
const video = (id, over = {}) => ({
  id,
  snippet: { title: `Video ${id}`, channelTitle: 'Chan', channelId: 'UC_x', publishedAt: '2026-01-01T00:00:00Z', thumbnails: { medium: { url: `https://i/${id}.jpg` } }, ...over.snippet },
  statistics: { viewCount: '1000', likeCount: '50', ...over.statistics },
  contentDetails: { duration: 'PT5M30S', ...over.contentDetails },
});
const mkFetch = (searchBody, videosBody) => async url => ({
  ok: true,
  json: async () => (url.includes('/search') ? searchBody : videosBody),
});

beforeEach(() => _cache.clear());

describe('durations', () => {
  it('parses ISO8601', () => {
    expect(parseDuration('PT5M30S')).toBe(330);
    expect(parseDuration('PT1H2M3S')).toBe(3723);
    expect(parseDuration('PT45S')).toBe(45);
    expect(parseDuration('')).toBeNull();
    expect(formatDuration(330)).toBe('5:30');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});

describe('trusted channels config', () => {
  it('parses name|id pairs only', () => {
    const m = trustedChannels({ YOUTUBE_TRUSTED_CHANNELS: 'A|UC1, B|, |UC3, C|UC4' });
    expect([...m.entries()]).toEqual([['UC1', 'A'], ['UC4', 'C']]);
  });
});

describe('search', () => {
  const searchBody = { items: [{ id: { videoId: 'v1' } }, { id: { videoId: 'v2' } }, { id: { videoId: 'v3' } }], nextPageToken: 'NEXT' };
  const videosBody = { items: [
    video('v1', { snippet: { channelId: 'UC_trusted1', publishedAt: new Date(Date.now() - 30 * 86400000).toISOString() } }),
    video('v2', { statistics: { viewCount: '5000000' }, snippet: { publishedAt: '2024-01-01T00:00:00Z' } }),
    video('v3'),
  ] };

  it('groups trusted results as recommended, rest as explore', async () => {
    const r = await search({ query: 'bench press form', apiKey: 'k', fetchImpl: mkFetch(searchBody, videosBody), env });
    expect(r.recommended).toHaveLength(1);
    expect(r.recommended[0].videoId).toBe('v1');
    expect(r.recommended[0].trusted).toBe(true);
    expect(r.recommended[0].trustedChannelName).toBe('Trusted Coach');
    expect(r.explore.map(v => v.videoId).sort()).toEqual(['v2', 'v3']);
    expect(r.nextPageToken).toBe('NEXT');
    expect(r.recommended[0].durationLabel).toBe('5:30');
    expect(r.recommended[0].viewCount).toBe(1000);
  });
  it('sorts by views and newest when requested', async () => {
    const byViews = await search({ query: 'q', sort: 'most-viewed', apiKey: 'k', fetchImpl: mkFetch(searchBody, videosBody), env });
    expect(byViews.explore[0].videoId).toBe('v2');
    const newest = await search({ query: 'q', sort: 'newest', apiKey: 'k', fetchImpl: mkFetch(searchBody, videosBody), env });
    expect(newest.explore[0].videoId).toBe('v3');
  });
  it('passes pageToken through to the API', async () => {
    const urls = [];
    const fetchSpy = async url => { urls.push(url); return { ok: true, json: async () => (url.includes('/search') ? searchBody : videosBody) }; };
    await search({ query: 'q', pageToken: 'PT2', apiKey: 'k', fetchImpl: fetchSpy, env });
    expect(urls[0]).toContain('pageToken=PT2');
  });
  it('fails cleanly without a key and maps quota errors', async () => {
    await expect(search({ query: 'q', apiKey: '' })).rejects.toThrow('not configured');
    const quota = async () => ({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } }) });
    await expect(search({ query: 'q', apiKey: 'k', fetchImpl: quota, env })).rejects.toMatchObject({ status: 403, quota: true });
  });
  it('returns empty groups when search finds nothing', async () => {
    const r = await search({ query: 'q', apiKey: 'k', fetchImpl: mkFetch({ items: [] }, { items: [] }), env });
    expect(r).toMatchObject({ recommended: [], explore: [], nextPageToken: null });
  });
  it('serves repeat calls from cache without extra requests', async () => {
    let calls = 0;
    const counting = async url => { calls += 1; return { ok: true, json: async () => (url.includes('/search') ? searchBody : videosBody) }; };
    await search({ query: 'q', apiKey: 'k', fetchImpl: counting, env });
    await search({ query: 'q', apiKey: 'k', fetchImpl: counting, env });
    expect(calls).toBe(2); // search + videos once
  });
});

describe('explainability, tags and reports', () => {
  const { detectTags, explain } = require('../src/services/youtubeService');
  it('detects variation tags only from title keywords', () => {
    expect(detectTags('Dumbbell Bench Press for Beginners')).toEqual(expect.arrayContaining(['dumbbell', 'beginner']));
    expect(detectTags('Fix Your Squat — 5 Mistakes')).toEqual(expect.arrayContaining(['mistakes']));
    expect(detectTags('Just a random vlog')).toEqual([]);
  });
  it('explains ranking without inventing credibility', () => {
    const trusted = new Map([['UC1', 'Coach']]);
    const item = { statistics: { viewCount: '2000000' }, snippet: { channelId: 'UC1', publishedAt: new Date().toISOString() } };
    expect(explain(item, 0, trusted)).toContain('reviewed list');
    expect(explain(item, 0, trusted)).toContain('2M views');
    expect(explain({ statistics: {}, snippet: { channelId: 'X' } }, 5, new Map())).toBe('Matched your search');
  });
});
