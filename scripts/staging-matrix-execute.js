#!/usr/bin/env node
// HUM-28 §6.2/§6.4 — serialized staging config-matrix execution.
// Enumerates the scenario set MECHANICALLY (flag x endpoint x expected behavior),
// never inventing case IDs: case id = FLAG-<n>-<flag> derived from the canonical
// registry order. Provenance: artifact id = staging deployment SHA + derivation rule.
// PostHog backend: baseline absent=false; setFlag(true)=create-or-enable 100% rollout,
// setFlag(false)=disable, restore of absent baseline = delete. Per-scenario evidence:
// manifest digest, deployment SHA, expected/actual, HTTP status, disposition.
const { createConfigMatrix } = require('./staging-config-matrix');
const https = require('https');
const crypto = require('crypto');

const HOST = 'fitness-app-backend-staging.up.railway.app';
const FLAGS = ['activity_safety_engine', 'weather_intelligence_v2', 'activity_safety_shadow_mode', 'health_aware_recommendations'];

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: HOST, path, method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 300) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body || {}));
  });
}
function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: HOST, path, headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 300) }));
    });
    req.on('error', reject);
    req.end();
  });
}

// PostHog backend over the MCP-proven project. Token passed via env — never logged.
function posthogBackend(apiKey, host = 'us.posthog.com', projectId = 701405) {
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const req = https.request({ host, path: `/api/projects/${projectId}/feature_flags${path}`, method, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
  async function readAll() {
    const out = {};
    for (const key of FLAGS) {
      const r = await call('GET', `/?search=${key}`);
      const rows = JSON.parse(r.body).results || [];
      const exact = rows.find((f) => f.key === key && !f.deleted);
      out[key] = !!(exact && exact.active);
    }
    return out;
  }
  return {
    getFlags: readAll,
    async setFlag(key, value) {
      const r = await call('GET', `/?search=${key}`);
      const rows = JSON.parse(r.body).results || [];
      const exact = rows.find((f) => f.key === key && !f.deleted);
      if (value) {
        if (!exact) await call('POST', '/', { key, name: `HUM-28 matrix — ${key} (temporary)`, active: true, filters: { groups: [{ properties: [], rollout_percentage: 100 }] } });
        else if (!exact.active) await call('PATCH', `/${exact.id}/`, { active: true });
      } else {
        if (exact && exact.active) await call('PATCH', `/${exact.id}/`, { active: false });
      }
      // PostHog evaluation propagation is near-realtime but not synchronous.
      await new Promise((r2) => setTimeout(r2, 4000));
    },
    async deleteIfCreated(key) {
      const r = await call('GET', `/?search=${key}`);
      const rows = JSON.parse(r.body).results || [];
      const exact = rows.find((f) => f.key === key && !f.deleted);
      if (exact) await call('DELETE', `/${exact.id}/`);
    },
  };
}

module.exports = { posthogBackend, post, get, FLAGS, HOST };
