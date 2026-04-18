// Simple per-user daily rate limiter (in-memory). Swap for Redis in production.

function createDailyLimiter({ limit, clock = () => new Date() }) {
  const counts = new Map(); // userId -> { day: 'YYYY-MM-DD', count: number }

  function dayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function status(userId) {
    const today = dayKey(clock());
    const entry = counts.get(userId);
    const count = entry && entry.day === today ? entry.count : 0;
    return { limit, used: count, remaining: Math.max(0, limit - count) };
  }

  function consume(userId) {
    if (!userId) throw new Error('userId required');
    const today = dayKey(clock());
    const entry = counts.get(userId);
    const current = entry && entry.day === today ? entry.count : 0;
    if (current >= limit) {
      return { allowed: false, limit, used: current, remaining: 0 };
    }
    counts.set(userId, { day: today, count: current + 1 });
    return { allowed: true, limit, used: current + 1, remaining: limit - (current + 1) };
  }

  function reset() { counts.clear(); }

  return { status, consume, reset };
}

module.exports = { createDailyLimiter };
