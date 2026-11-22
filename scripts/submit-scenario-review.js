// Reviewer-decision recorder for scenario fixtures.
// Usage: node scripts/submit-scenario-review.js <ID> approve|reject "justification"
// Reviewer identity comes from SCENARIO_REVIEWER env (e.g. name/email) — required,
// never invented. Appends an immutable, hash-chained record to
// data/scenarioReviewDecisions.json.
const fs = require('node:fs'), crypto = require('node:crypto');
const FILE = 'data/scenarioReviewDecisions.json';
const [id, decision, ...just] = process.argv.slice(2);
const reviewer = process.env.SCENARIO_REVIEWER;
if (!id || !/^[A-L]\d{2}$/.test(id)) { console.error('bad scenario id'); process.exit(1); }
if (!['approve', 'reject'].includes(decision)) { console.error('decision must be approve|reject'); process.exit(1); }
if (!reviewer || reviewer.length < 3) { console.error('set SCENARIO_REVIEWER=<your identity>'); process.exit(1); }
const justification = just.join(' ');
if (justification.length < 10) { console.error('justification >= 10 chars'); process.exit(1); }
const store = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { version: 'review-v1', decisions: [] };
const prev = store.decisions[store.decisions.length - 1];
const rec = { scenarioId: id, decision, reviewer, justification, at: new Date().toISOString(), prevHash: prev ? prev.hash : null };
rec.hash = crypto.createHash('sha256').update(JSON.stringify({ ...rec, hash: undefined })).digest('hex');
store.decisions.push(rec);
fs.writeFileSync(FILE, JSON.stringify(store, null, 2) + '\n');
console.log('recorded', id, decision, 'by', reviewer, 'hash', rec.hash.slice(0, 12));
