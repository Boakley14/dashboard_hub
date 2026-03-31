/**
 * api/update/index.js
 * HTTP POST — patches fields on an existing registry entry.
 * Uses the same read-modify-write blob pattern as upload and delete.
 *
 * Expected JSON body:
 *   { id: string, updates: { category?, accentColor?, title?, description?, ... } }
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME
 *   AZURE_STORAGE_SAS_TOKEN
 */

const https = require('https');
const { autoMatchOrRegister } = require('../data-sources/index');

const CONTAINER     = 'dashboards';
const REGISTRY_BLOB = 'registry.json';

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method Not Allowed' };
    return;
  }

  const { id, updates } = req.body || {};
  if (!id || !updates || typeof updates !== 'object') {
    context.res = { status: 400, body: { error: 'Missing required fields: id, updates.' } };
    return;
  }

  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

  if (!account || !sasToken) {
    context.res = { status: 500, body: { error: 'Storage not configured on server.' } };
    return;
  }

  // Disallow overwriting immutable identity fields via updates
  const PROTECTED = ['id', 'filename', 'blobUrl'];
  PROTECTED.forEach(k => delete updates[k]);

  try {
    const host = `${account}.blob.core.windows.net`;

    // ---- 1. Read registry ----
    const getRes = await blobGet(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`);
    if (getRes.statusCode !== 200) {
      throw new Error(`Registry not found: ${getRes.statusCode}`);
    }

    let registry = [];
    try { registry = JSON.parse(getRes.body); } catch { registry = []; }

    // ---- 2. Find and patch entry ----
    const idx = registry.findIndex(d => d.id === id);
    if (idx === -1) {
      context.res = { status: 404, body: { error: `Dashboard '${id}' not found in registry.` } };
      return;
    }

    // If a dataConnection is being set, auto-match or register it in the global registry
    if (updates.dataConnection) {
      const principalName = req.headers?.['x-ms-client-principal-name'];
      updates.dataConnection = await autoMatchOrRegister(
        updates.dataConnection, account, sasToken, principalName
      ).catch(() => updates.dataConnection);  // silently degrade on error
    }

    registry[idx] = { ...registry[idx], ...updates };
    const patchedEntry = registry[idx];

    // ---- 3. Write registry back ----
    const buf = Buffer.from(JSON.stringify(registry, null, 2) + '\n', 'utf-8');
    const putRes = await blobPut(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`, buf, 'application/json');
    if (putRes.statusCode >= 300) {
      throw new Error(`Registry update failed: ${putRes.statusCode} — ${putRes.body}`);
    }

    context.res = { status: 200, body: { success: true, entry: patchedEntry } };

  } catch (err) {
    context.log.error('[update]', err.message);
    context.res = { status: 500, body: { error: err.message } };
  }
};

// ---- Helpers -----------------------------------------------

function blobGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, path, method: 'GET',
      headers: { 'x-ms-date': new Date().toUTCString(), 'x-ms-version': '2020-04-08' }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function blobPut(host, path, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, path, method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-date':      new Date().toUTCString(),
        'x-ms-version':   '2020-04-08',
        'Content-Type':   contentType,
        'Content-Length': buffer.length
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}
