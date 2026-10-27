const fs = require('node:fs');
const path = require('node:path');
const { getPrisma } = require('../src/lib/prisma');
const { importCatalog } = require('../src/services/ingredientCatalog');
const args = process.argv.slice(2);
if (args.some(x => x !== '--apply')) throw Error('Usage: node scripts/import-ingredients.js [--apply]. DATABASE_URL selects the target; preview is the default.');
(async () => {
 try { console.log(JSON.stringify(await importCatalog(getPrisma(), JSON.parse(fs.readFileSync(path.join(__dirname, '../data/humai-ingredients.json'), 'utf8')), args.includes('--apply')), null, 2)); }
 catch (error) { console.error(error.status || error.code === 'CATALOG_VALIDATION' ? error.message : 'Catalog import failed; no partial import committed. Check catalog validation and database configuration.'); process.exitCode = 1; }
 finally { await getPrisma().$disconnect(); }
})();
