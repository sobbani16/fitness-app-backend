// YouTube Data API v3 integration. API key stays server-side (YOUTUBE_API_KEY).
// Trusted channels come from env config — YOUTUBE_TRUSTED_CHANNELS as
// "Name|UCchannelId,Name2|UCyyy". Never invent credentials or review scores:
// `trusted` means "on Humai's curated channel list", not "medically verified".

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const SEARCH_TTL_MS = 15 * 60 * 1000;
const MAX_RESULTS = 10;

const cache = new Map(); // key -> { at, data }
function cached(key, compute) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.data;
  const data = compute();
  cache.set(key, { at: Date.now(), data });
  return data;
}

function trustedChannels(env = process.env) {
  const raw = env.YOUTUBE_TRUSTED_CHANNELS || '';
  const map = new Map();
  for (const part of raw.split(',')) {
    const [name, id] = part.split('|').map(s => s?.trim());
    if (name && id) map.set(id, name);
  }
  return map;
}

function parseDuration(iso) {
  if (!iso) return null;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return null;
  const s = (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
  return Number.isFinite(s) ? s : null;
}

function formatDuration(seconds) {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function ageDays(publishedAt, now = Date.now()) {
  const t = new Date(publishedAt).getTime();
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86400000) : null;
}

// Deterministic ranking: relevance position + log views + recency + trusted
// boost. High views alone never imply accuracy — position and curation matter.
function score(item, index, trusted) {
  const views = Number(item.statistics?.viewCount) || 0;
  const days = ageDays(item.snippet?.publishedAt);
  const relevance = Math.max(0, MAX_RESULTS - index);
  const popularity = Math.log10(views + 1);
  const recency = days == null ? 0 : Math.max(0, 365 - Math.min(days, 365)) / 365;
  const curated = trusted.has(item.snippet?.channelId) ? 10 : 0;
  return relevance + popularity + recency + curated;
}

function toResult(item, index, trusted, now) {
  const seconds = parseDuration(item.contentDetails?.duration);
  return {
    videoId: item.id,
    title: item.snippet?.title || '',
    channelTitle: item.snippet?.channelTitle || '',
    channelId: item.snippet?.channelId || '',
    publishedAt: item.snippet?.publishedAt || null,
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
    viewCount: item.statistics?.viewCount != null ? Number(item.statistics.viewCount) : null,
    likeCount: item.statistics?.likeCount != null ? Number(item.statistics.likeCount) : null,
    durationSeconds: seconds,
    durationLabel: formatDuration(seconds),
    trusted: trusted.has(item.snippet?.channelId),
    trustedChannelName: trusted.get(item.snippet?.channelId) || null,
  };
}

async function ytGet(fetchImpl, path, params) {
  const url = `${API_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetchImpl(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`YouTube API error: ${reason}`);
    err.status = res.status;
    err.quota = res.status === 403;
    throw err;
  }
  return body;
}

// search.list returns IDs only; videos.list enriches with statistics/duration.
// Two requests per page — bounded and cached for 15 minutes.
async function search({ query, context = 'general', pageToken, sort = 'recommended', apiKey = process.env.YOUTUBE_API_KEY, fetchImpl = fetch, env = process.env }) {
  if (!apiKey) { const e = new Error('Video search is not configured'); e.status = 503; throw e; }
  if (!query || !query.trim()) { const e = new Error('query is required'); e.status = 400; throw e; }
  const trusted = trustedChannels(env);
  const order = sort === 'newest' ? 'date' : sort === 'relevance' ? 'relevance' : 'relevance';
  const key = `${query}|${context}|${pageToken || ''}`;
  const searchBody = await cached(`s|${key}`, () => ytGet(fetchImpl, '/search', {
    key: apiKey, part: 'snippet', type: 'video', maxResults: MAX_RESULTS,
    q: query, order, videoEmbeddable: 'true', safeSearch: 'strict', ...(pageToken ? { pageToken } : {}),
  }));
  const ids = (searchBody.items || []).map(i => i.id?.videoId).filter(Boolean);
  if (!ids.length) return { recommended: [], explore: [], nextPageToken: searchBody.nextPageToken || null, query };
  const videosBody = await cached(`v|${ids.join(',')}`, () => ytGet(fetchImpl, '/videos', {
    key: apiKey, part: 'snippet,statistics,contentDetails', id: ids.join(','),
  }));
  const now = Date.now();
  let items = (videosBody.items || []).map((item, i) => ({ ...toResult(item, i, trusted, now), _score: score(item, i, trusted) }));
  if (sort === 'most-viewed') items.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
  else if (sort === 'newest') items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  else items.sort((a, b) => b._score - a._score);
  const recommended = items.filter(i => i.trusted);
  const explore = items.filter(i => !i.trusted);
  return { recommended, explore, nextPageToken: searchBody.nextPageToken || null, query };
}

module.exports = { search, parseDuration, formatDuration, score, trustedChannels, _cache: cache };
