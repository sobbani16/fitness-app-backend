// Fail before database changes if the new server cannot start.
require('../src/services/authLifecycle').validateConfig();
const { spawnSync } = require('node:child_process');
for (const args of [['run', 'db:deploy'], ['run', 'db:seed-rbac']]) {
  const result = spawnSync('npm', args, { stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
