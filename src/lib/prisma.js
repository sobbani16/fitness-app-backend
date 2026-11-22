// Lazily-instantiated Prisma client singleton.
//
// Why lazy: `new PrismaClient()` throws if the client hasn't been generated
// (`npx prisma generate`) or no DATABASE_URL is configured. Importing this
// module must stay side-effect free so the existing test suite (which never
// touches the DB) keeps loading `app.js` without a database.
//
// Call getPrisma() only from code paths that actually query the database.

let client = null;

function getPrisma() {
  if (!client) {
    // Require lazily: `@prisma/client` can throw before `prisma generate`
    // has run. Deferring keeps module import side-effect free.
    const { PrismaClient } = require('@prisma/client');
    // Under test, cap the query-engine pool — a suite run must not be able to
    // burst connections against Postgres max_connections while dev servers hold
    // their own pools (Phase-17 §9 root cause).
    let opts;
    if (process.env.NODE_ENV === 'test' && process.env.DATABASE_URL && !/connection_limit=/.test(process.env.DATABASE_URL)) {
      const sep = process.env.DATABASE_URL.includes('?') ? '&' : '?';
      opts = { datasources: { db: { url: `${process.env.DATABASE_URL}${sep}connection_limit=5` } } };
    }
    client = global.__fitnessPrisma || new PrismaClient(opts);
    if (process.env.NODE_ENV !== 'production') {
      global.__fitnessPrisma = client;
    }
  }
  return client;
}

module.exports = { getPrisma };
