/* Operator workflow: independently verify ownership BEFORE running this script.
 * A device ID, cached health data, screenshots or a newly verified email alone
 * are NOT independent proof. Never issue a grant solely on that basis.
 */
require('dotenv').config();
const fs = require('node:fs');
const { issueGrant } = require('../src/services/legacyMigration');
const { getPrisma } = require('../src/lib/prisma');
async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) options[args[i]] = args[i + 1];
  if (options['--attest-independent-review'] !== 'yes' || !options['--output'] || !options['--legacy-id'] || !options['--target-email']) throw new Error('Required: --legacy-id ID --target-email EMAIL --proof-type TYPE --evidence-reference TICKET --attest-independent-review yes --output PRIVATE_FILE');
  // Reserve the file before issuing; never overwrite an existing secret or print it to logs.
  const fd = fs.openSync(options['--output'], 'wx', 0o600);
  try {
    const token = await issueGrant({ legacyUserId: options['--legacy-id'], targetEmail: options['--target-email'], proofType: options['--proof-type'], evidenceReference: options['--evidence-reference'] });
    fs.writeFileSync(fd, `${token}\n`);
    console.log('Single-use code written to the private output file. Expires in 30 minutes. Deliver through the independently verified channel.');
  } finally { fs.closeSync(fd); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => getPrisma().$disconnect());
