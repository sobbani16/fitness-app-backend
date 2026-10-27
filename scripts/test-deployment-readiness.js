const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { spawnSync } = require('node:child_process');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (url.hostname !== '127.0.0.1' || !/^\/fitness_d03_[a-z0-9_]+$/.test(url.pathname)) throw new Error('Dedicated empty local fitness_d03_* database required');
const { PrismaClient } = require('@prisma/client');
const { assertDeploymentReady } = require('../src/services/deploymentReadiness');
const db = new PrismaClient();
const env = { ...process.env, NODE_ENV: 'production', AUTH_LINK_SECRET: 'ab'.repeat(32), AUTH_PUBLIC_URL: 'https://example.test', AUTH_EMAIL_FROM: 'Fixture <account@example.test>', RESEND_API_KEY: 'fixture-no-network' };
delete env.AUTH_TEST_BYPASS;
Object.assign(process.env, env); delete process.env.AUTH_TEST_BYPASS;
global.__fitnessPrisma = db;
const app = require('../src/app');
function run(script, overrides = {}) { return spawnSync(process.execPath, [script], { env: { ...env, ...overrides }, encoding: 'utf8', timeout: 120000 }); }
(async () => {
  try {
    const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`;
    assert.equal(tables.length, 0, 'Use a fresh empty database; this script never cleans existing databases');
    assert.notEqual(run('scripts/deploy-prepare.js', { AUTH_LINK_SECRET: '' }).status, 0);
    assert.equal((await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`).length, 0);
    const earlyStart = run('src/index.js');
    assert.equal(earlyStart.status, 1); assert(!earlyStart.stdout.includes('Backend listening'));
    console.log('PASS invalid config changes no database; production startup refuses an unmigrated database');
    const prepared = run('scripts/deploy-prepare.js');
    assert.equal(prepared.status, 0, prepared.stderr);
    const result = await assertDeploymentReady(db);
    await request(app).get('/health/ready').expect(200);
    const counts = async () => Promise.all([db.role.count(), db.permission.count(), db.rolePermission.count(), db.user.count(), db.userRole.count()]);
    const before = await counts(); assert.equal(before[3], 0); assert.equal(before[4], 0);
    assert.equal(run('scripts/deploy-prepare.js').status, 0);
    assert.deepEqual(await counts(), before);
    console.log(`PASS ${result.migrations} migrations and RBAC prepared; repeat preparation is idempotent and grants no user roles`);
    const row = (await db.$queryRaw`SELECT id, checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 1`)[0];
    await db.$executeRaw`UPDATE "_prisma_migrations" SET checksum = ${'0'.repeat(64)} WHERE id = ${row.id}`;
    assert.equal(run('scripts/check-deployment.js').status, 1);
    await request(app).get('/health/ready').expect(503);
    assert.equal(run('src/index.js').status, 1);
    await db.$executeRaw`UPDATE "_prisma_migrations" SET checksum = ${row.checksum} WHERE id = ${row.id}`;
    const mapping = await db.rolePermission.findFirst();
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: mapping.roleId, permissionId: mapping.permissionId } } });
    assert.equal(run('scripts/check-deployment.js').status, 1);
    await request(app).get('/health/ready').expect(503);
    assert.equal(run('src/index.js').status, 1);
    assert.equal(run('scripts/deploy-prepare.js').status, 0);
    await assertDeploymentReady(db);
    console.log('PASS changed migration checksum and missing RBAC block startup; preparation repairs required RBAC');
    await request(app).get('/health/ready').expect(200);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-d03-restore-'));
    const dump = path.join(directory, 'snapshot.dump');
    const restoredName = `${url.pathname.slice(1)}_restore`;
    const restoredUrl = new URL(url); restoredUrl.pathname = '/' + restoredName;
    try {
      assert.equal(spawnSync('/opt/homebrew/bin/pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dump, url.href], { encoding: 'utf8' }).status, 0);
      fs.chmodSync(dump, 0o600);
      assert.equal(spawnSync('/opt/homebrew/bin/createdb', ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), restoredName], { encoding: 'utf8' }).status, 0, 'Restore target must be a new database');
      assert.equal(spawnSync('/opt/homebrew/bin/pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '-d', restoredUrl.href, dump], { encoding: 'utf8' }).status, 0);
      const restored = new PrismaClient({ datasources: { db: { url: restoredUrl.href } } });
      try { assert.deepEqual(await assertDeploymentReady(restored), result); assert.equal(await restored.user.count(), 0); }
      finally { await restored.$disconnect(); }
      console.log('PASS local PostgreSQL snapshot restored into a separate database and passed migration/RBAC readiness');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }

  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
