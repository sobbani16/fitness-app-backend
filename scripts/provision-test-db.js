#!/usr/bin/env node
/**
 * provision-test-db.js — idempotent, migration-driven test-database provisioning.
 *
 * Why this exists (QA defect #330): suites were failing with
 * `The table public.X does not exist in the current database` because the
 * databases tests actually connect to were never provisioned with the
 * migration set — humai_qa_test (the shell-injected default) held a single
 * marker table, and fitness_test is a drifted copy with no migration ledger.
 *
 * What it does, in order:
 *   1. Positively identifies the target as a LOCAL database whose name is
 *      labeled `test` — anything else is refused outright.
 *   2. Serializes provisioning across concurrent processes with a Postgres
 *      advisory lock (parallel jest/agent runs are the norm on this machine).
 *   3. Re-checks state AFTER acquiring the lock — losers of the race fast-path.
 *   4. Applies `prisma migrate deploy` when migrations are pending or the
 *      database is empty. A database that has schema but NO migration ledger
 *      is a drifted copy — provisioning REFUSES rather than guessing, because
 *      replaying migrations onto existing tables would crash half-applied.
 *   5. Verifies mechanically: every `model` in prisma/schema.prisma (honoring
 *      @@map) must exist as a table afterward. Missing tables are reported
 *      by name — silently incomplete schema is what caused the defect.
 *
 * Usage: node scripts/provision-test-db.js [postgres-url]
 *   URL resolution order: argument > TEST_DATABASE_URL > DATABASE_URL.
 *
 * Exit 0 = provisioned-or-already-current AND verification passed.
 * Exit 1 = refused or failed; the message says exactly why and what to do.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isPositiveTestDatabase } = require('../tests/testDbUrl');

const LOCK_KEY = 727001; // arbitrary constant — shared by every provisioner of any local test db

// Test-harness infrastructure tables that are NOT part of the Prisma schema.
// `_humai_test_environment` is the QA harness's database label (single-row
// marker, e.g. 'isolated_qa_test'). Prisma's P3005 guard refuses migrate deploy
// on ANY non-empty ledgerless database, so these tables are captured
// (DDL+data), dropped, and restored around the initial provisioning. They are
// infrastructure, not drift — never treated as user data and never abandoned.
const INFRA_TABLES = ['_humai_test_environment'];
const root = path.join(__dirname, '..');

function migrationFolders() {
  return fs.readdirSync(path.join(root, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+_/.test(d.name))
    .map((d) => d.name)
    .sort();
}

/** Expected table names derived mechanically from schema.prisma (honors @@map). */
function expectedTables() {
  const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
  const tables = [];
  const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = modelRe.exec(schema))) {
    const mapMatch = m[2].match(/@@map\(\s*"([^"]+)"\s*\)/);
    tables.push(mapMatch ? mapMatch[1] : m[1]);
  }
  return tables.sort();
}

function redact(url) {
  return url.replace(/:\/\/[^@]*@/, '://***@');
}

async function main() {
  const url = process.argv[2] || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('[provision] REFUSED: no database URL — pass one, or set TEST_DATABASE_URL/DATABASE_URL.');
    process.exit(1);
  }
  const id = isPositiveTestDatabase(url);
  if (!id.ok) {
    console.error(`[provision] REFUSED: target ${redact(url)} is not a positively-identified LOCAL test database ` +
      `(localhost-family host AND "test" in the name required; got host-local=${id.isLocal}, name="${id.name}"). ` +
      'Never provision remote or unlabeled databases.');
    process.exit(1);
  }

  const { PrismaClient } = require('@prisma/client');
  let prisma = new PrismaClient({ datasources: { db: { url } } });

  // Zero-touch creation: a positively-identified local test database that
  // does not exist yet is created through the maintenance database with the
  // same credentials. Creation is non-destructive by nature — everything
  // else about the target still goes through the exact same provisioning.
  const probe = prisma.$queryRawUnsafe('SELECT 1').then(() => true).catch(async (err) => {
    if (!/does not exist|P1003/i.test(String(err.message || err))) throw err;
    const maint = url.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
    const admin = new PrismaClient({ datasources: { db: { url: maint } } });
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${id.name}"`);
      console.log(`[provision] created empty database ${id.name}`);
    } catch (createErr) {
      console.error(`[provision] FAILED: database "${id.name}" does not exist and could not be created with the URL credentials: ${String(createErr.message).slice(0, 200)}`);
      process.exit(1);
    } finally {
      await admin.$disconnect().catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
    prisma = new PrismaClient({ datasources: { db: { url } } });
    return true;
  });
  await probe.catch((err) => {
    console.error(`[provision] FAILED: cannot reach target database: ${String(err.message).slice(0, 300)}`);
    process.exit(1);
  });

  const folders = migrationFolders();
  const expected = expectedTables();

  const state = async (tx) => {
    const q = (c) => (tx || prisma).$queryRawUnsafe(c);
    const infraList = INFRA_TABLES.map((t) => `'${t}'`).join(',');
    const tbl = await q(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name NOT IN (${infraList})`);
    const ledger = await q("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations'");
    let applied = 0;
    if (ledger[0].n === 1) {
      const rows = await q("SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL");
      applied = rows[0].n;
    }
    // Seed presence — reference data is part of correct provisioning; its
    // absence must not fast-path even when migrations are current. Existence
    // is checked through information_schema FIRST: querying a missing table
    // inside the lock transaction would poison it (25P02).
    let roles = 0, nutrients = 0;
    const present = new Set((await q(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('Role','Nutrient')")).map((r) => r.table_name));
    if (present.has('Role')) roles = (await q('SELECT count(*)::int AS n FROM "Role"'))[0].n;
    if (present.has('Nutrient')) nutrients = (await q('SELECT count(*)::int AS n FROM "Nutrient"'))[0].n;
    return { tableCount: tbl[0].n, hasLedger: ledger[0].n === 1, applied, roles, nutrients };
  };

  const verify = async () => {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const present = new Set(rows.map((r) => r.table_name));
    const missing = expected.filter((t) => !present.has(t));
    return { missing, presentCount: present.size };
  };

  try {
    // Wait-holding interactive transaction pins one connection; the advisory
    // lock is held for the whole provisioning critical section, including the
    // child-process migrate deploy.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_lock(${LOCK_KEY})`);
      try {
        const s = await state(tx);
        console.log(`[provision] target=${redact(url)} tables=${s.tableCount} ledger=${s.hasLedger} applied=${s.applied}/${folders.length}`);

        if (!s.hasLedger && s.tableCount > 2) {
          console.error('[provision] REFUSED: database has schema but NO migration ledger — this is a drifted copy ' +
            '(e.g. created by pg_dump/db push), not a migration-provisioned database. Replaying migrations onto it ' +
            'would crash half-applied. Options: (a) use a fresh or empty test database, (b) drop/recreate this one ' +
            'deliberately if you own it and its contents are disposable, (c) baseline it manually after verifying ' +
            'drift with `prisma migrate diff`. Provisioning never guesses.');
          process.exitCode = 1;
          return;
        }

        if (s.applied < folders.length || !s.hasLedger) {
          // P3005 avoidance: capture+drop infra tables around the FIRST
          // provisioning only (ledger exists afterward, so this runs once).
          const infraPresent = (await tx.$queryRawUnsafe(
            `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN (${INFRA_TABLES.map((t) => `'${t}'`).join(',')})`))
            .map((r) => r.table_name);
          const needInfraDance = !s.hasLedger && infraPresent.length > 0;
          const creds = url.match(/^postgresql:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\//);
          const capture = (table) => {
            const env = { ...process.env };
            if (creds) env.PGPASSWORD = creds[2];
            const args = ['-h', creds ? creds[3] : 'localhost'];
            if (creds && creds[4]) args.push('-p', creds[4]);
            args.push('-U', creds ? creds[1] : 'sobbani', '-d', id.name, '-t', table);
            const r = spawnSync('pg_dump', args, { encoding: 'utf8', env, timeout: 60000 });
            return r.status === 0 ? r.stdout : null;
          };
          const psql = (sql) => {
            const env = { ...process.env };
            if (creds) env.PGPASSWORD = creds[2];
            const args = ['-h', creds ? creds[3] : 'localhost'];
            if (creds && creds[4]) args.push('-p', creds[4]);
            args.push('-U', creds ? creds[1] : 'sobbani', '-d', id.name, '-v', 'ON_ERROR_STOP=1', '-c', sql);
            return spawnSync('psql', args, { encoding: 'utf8', env, timeout: 60000 });
          };
          const dumps = {};
          if (needInfraDance) {
            for (const t of infraPresent) {
              dumps[t] = capture(t);
              if (!dumps[t]) {
                console.error(`[provision] FAILED: could not capture infrastructure table ${t} via pg_dump — refusing to risk harness state.`);
                process.exitCode = 1;
                return;
              }
            }
            for (const t of infraPresent) {
              const d = psql(`DROP TABLE IF EXISTS "${t}"`);
              if (d.status !== 0) {
                console.error(`[provision] FAILED: could not temporarily move infrastructure table ${t}: ${(d.stderr || '').slice(0, 200)}`);
                process.exitCode = 1;
                return;
              }
            }
            console.log(`[provision] infrastructure tables captured+moved aside for initial provisioning: ${infraPresent.join(', ')}`);
          }
          console.log(`[provision] applying migrations — ${folders.length - s.applied} pending (migrate deploy)...`);
          const run = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
            cwd: root,
            env: { ...process.env, DATABASE_URL: url },
            encoding: 'utf8',
            timeout: 300000,
          });
          if (run.status !== 0) {
            console.error(`[provision] migrate deploy FAILED (exit ${run.status}):\n${(run.stderr || run.stdout || '').slice(-2000)}`);
            process.exitCode = 1;
            return;
          }
          if (needInfraDance) {
            for (const t of infraPresent) {
              // Restore via stdin, never -c: pg_dump output carries psql
              // meta-commands (\restrict/\unrestrict in pg_dump 18+) that
              // only parse in script mode.
              const r = spawnSync('psql', ['-h', creds ? creds[3] : 'localhost', '-U', creds ? creds[1] : 'sobbani', '-d', id.name, '-v', 'ON_ERROR_STOP=1', '-q'], { input: dumps[t], encoding: 'utf8', env: { ...process.env, ...(creds ? { PGPASSWORD: creds[2] } : {}) }, timeout: 60000 });
              if (r.status !== 0) {
                console.error(`[provision] WARNING: infrastructure table ${t} restore failed: ${(r.stderr || '').slice(0, 200)} — recheck the QA harness label manually`);
              } else {
                console.log(`[provision] infrastructure table ${t} restored`);
              }
            }
          }
          const after = await state(tx);
          console.log(`[provision] migrate deploy complete — applied=${after.applied}/${folders.length}`);

        } else {
          console.log('[provision] migrations already current — fast path');
        }

        // Reference seeds run whenever missing — idempotent, so reapplication is safe.
        const sNow = await state(tx);
        if (sNow.roles === 0 || sNow.nutrients === 0) {
        // Reference seeds: small, idempotent (upsert/create-if-missing), and
        // structurally required by the application — RBAC roles/permissions
        // gate every RBAC surface and the nutrient master list is the
        // nutrition system's stable identity set. Demo/content seeds
        // (seed-foods, seed-trainers, seed-dummy, seed.js) are deliberately
        // EXCLUDED: they pollute orphan-audit and counting suites.
        for (const seed of ['prisma/seed-rbac.js', 'prisma/seed-nutrients.js']) {
          const sr = spawnSync(process.execPath, [path.join(root, seed)], {
            env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 120000,
          });
          if (sr.status !== 0) {
            console.error(`[provision] reference seed ${seed} FAILED:\n${(sr.stderr || sr.stdout || '').slice(-800)}`);
            process.exitCode = 1;
            return;
          }
          console.log(`[provision] reference seed applied: ${seed}`);
        }
        }
      } finally {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
      }
    }, { timeout: 330000, maxWait: 330000 });

    if (process.exitCode === 1) return;

    const v = await verify();
    if (v.missing.length > 0) {
      console.error(`[provision] VERIFY FAILED — ${v.missing.length} schema table(s) missing after provisioning: ${v.missing.slice(0, 12).join(', ')}${v.missing.length > 12 ? ` (+${v.missing.length - 12} more)` : ''}`);
      process.exit(1);
    }
    console.log(`[provision] VERIFIED — all ${expected.length} schema tables present in ${id.name} (total tables: ${v.presentCount}). Database is migration-provisioned and suite-ready.`);
  } catch (err) {
    if (String(err.message).includes('does not exist') && String(err.message).includes('database')) {
      console.error(`[provision] FAILED: database "${id.name}" does not exist. Create it first, e.g.: ` +
        `psql -U <owner> -d postgres -c "CREATE DATABASE \\"${id.name}\\";" — the owner must match the URL credentials.`);
    } else {
      console.error(`[provision] FAILED: ${err.message.slice(0, 500)}`);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main();
