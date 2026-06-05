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
    client = global.__fitnessPrisma || new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
      global.__fitnessPrisma = client;
    }
  }
  return client;
}

module.exports = { getPrisma };
