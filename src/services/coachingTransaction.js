const { getPrisma } = require('../lib/prisma');
// Callbacks contain database work only: serialization retries must never resend external effects.
async function coachingTransaction(callback) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getPrisma().$transaction(callback, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 15000 });
    } catch (error) {
      if (error.code !== 'P2034' || attempt >= 2) throw error;
    }
  }
}
module.exports = { coachingTransaction };
