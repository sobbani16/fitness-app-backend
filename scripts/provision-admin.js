// No password creation, auto-verification, default admin or public recovery endpoint.
const { provisionAdmin, ProvisioningError } = require('../src/services/adminProvisioning');
const HELP = 'Preview: npm run admin:provision -- --mode bootstrap|recover --user-id UUID --operator OPERATOR_REF --reference REVIEW_TICKET\nApply adds: --apply --reviewed --expected-state PREVIEW_SHA256\nUse existing verified individual accounts; review the runbook before applying. DATABASE_URL must be set securely.';
function parseArgs(args) {
  const values = { '--mode': 'mode', '--user-id': 'userId', '--operator': 'operator', '--reference': 'reference', '--expected-state': 'expectedState' };
  const flags = { '--apply': 'apply', '--reviewed': 'reviewed' }, options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], field = values[arg] || flags[arg];
    if (!field || Object.hasOwn(options, field)) throw new ProvisioningError('Unknown or duplicate argument. Use --help.');
    if (flags[arg]) options[field] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new ProvisioningError('Missing argument value. Use --help.');
      options[field] = value;
    }
  }
  return options;
}
async function main() {
  if (process.argv.slice(2).includes('--help')) { console.log(HELP); return; }
  const options = parseArgs(process.argv.slice(2));
  const { validate, targetIdentity } = require('../src/services/adminProvisioning');
  validate(options); targetIdentity(process.env.DATABASE_URL); // Never load an implicit .env deployment target.
  const db = require('../src/lib/prisma').getPrisma();
  try { console.log(JSON.stringify(await provisionAdmin(db, options), null, 2)); }
  finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(error => {
  // Do not print Prisma errors/connection strings, account details or stack traces.
  console.error(error instanceof ProvisioningError ? error.message : 'Provisioning failed; no success confirmed. Inspect access and database readiness securely, then preview again.');
  process.exitCode = 1;
});
module.exports = { parseArgs };
