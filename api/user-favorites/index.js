/**
 * api/user-favorites/index.js
 * GET  — returns the signed-in user's favorite dashboard IDs
 * POST — adds or removes a dashboard from the user's favorites
 *
 * User identity is injected by Azure Static Web Apps' auth middleware:
 *   x-ms-client-principal-id   → stable unique user ID (Entra object ID)
 *   x-ms-client-principal-name → display name / UPN
 *
 * Favorites are stored per-user in blob storage:
 *   Container:  dashboards
 *   Blob name:  user-data/{userId}.json
 *   Shape:      { userId, displayName, favorites: string[], updatedAt }
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME
 *   AZURE_STORAGE_SAS_TOKEN
 */

const https = require('https');

const CONTAINER = 'dashboards';
const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
};

module.exports = async function (context, req) {
  // ---- OPTIONS preflight ------------------------------------
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS };
    return;
  }

  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
  if (!account || !sasToken) {
    context.res = { status: 500, headers: CORS, body: { error: 'Storage not configured.' } };
    return;
  }

  // ---- Resolve user identity --------------------------------
  // SWA injects the principal headers for authenticated users.
  // Falls back gracefully so local dev without SWA CLI still works.
  const userId      = req.headers['x-ms-client-principal-id']   || null;
  const displayName = req.headers['x-ms-client-principal-name'] || 'Unknown User';

  if (!userId) {
    // Not authenticated — return empty favorites (shouldn't happen in prod since SWA requires auth)
    context.res = { status: 200, headers: CORS, body: { favorites: [], authenticated: false } };
    return;
  }

  const host     = `${account}.blob.core.windows.net`;
  const blobName = `user-data/${userId}.json`;
  const blobPath = `/${CONTAINER}/${blobName}?${sasToken}`;

  // ---- GET — return current favorites -----------------------
  if (req.method === 'GET') {
    try {
      const res = await blobGet(host, blobPath);
      if (res.statusCode === 404) {
        context.res = { status: 200, headers: CORS, body: { favorites: [], userId, displayName } };
        return;
      }
      if (res.statusCode !== 200) throw new Error(`Blob GET ${res.statusCode}`);
      const data = JSON.parse(res.body);
      context.res = {
        status: 200,
        headers: { ...CORS, 'Cache-Control': 'no-store' },
        body: { favorites: data.favorites ?? [], userId, displayName },
      };
    } catch (err) {
      context.log?.error('[user-favorites GET]', err.message);
      context.res = { status: 500, headers: CORS, body: { error: err.message } };
    }
    return;
  }

  // ---- POST — toggle a favorite -----------------------------
  if (req.method === 'POST') {
    const { action, dashboardId } = req.body || {};

    if (!action || !dashboardId) {
      context.res = { status: 400, headers: CORS, body: { error: 'Missing: action (add|remove) and dashboardId' } };
      return;
    }
    if (action !== 'add' && action !== 'remove') {
      context.res = { status: 400, headers: CORS, body: { error: 'action must be "add" or "remove"' } };
      return;
    }

    try {
      // Read current favorites (404 = first time = empty)
      let current = [];
      const getRes = await blobGet(host, blobPath);
      if (getRes.statusCode === 200) {
        try { current = JSON.parse(getRes.body).favorites ?? []; } catch { current = []; }
      }

      // Apply the toggle
      const favSet = new Set(current);
      if (action === 'add')    favSet.add(dashboardId);
      if (action === 'remove') favSet.delete(dashboardId);
      const updated = [...favSet];

      // Write back
      const payload = JSON.stringify({ userId, displayName, favorites: updated, updatedAt: new Date().toISOString() });
      const buf     = Buffer.from(payload, 'utf-8');
      const putRes  = await blobPut(host, blobPath, buf, 'application/json');
      if (putRes.statusCode >= 300) throw new Error(`Blob PUT ${putRes.statusCode}: ${putRes.body}`);

      context.res = {
        status: 200,
        headers: { ...CORS, 'Cache-Control': 'no-store' },
        body: { favorites: updated, userId },
      };

    } catch (err) {
      context.log?.error('[user-favorites POST]', err.message);
      context.res = { status: 500, headers: CORS, body: { error: err.message } };
    }
    return;
  }

  context.res = { status: 405, headers: CORS, body: { error: 'Method Not Allowed' } };
};

// ---- Blob helpers ------------------------------------------

function blobGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, path, method: 'GET',
      headers: { 'x-ms-date': new Date().toUTCString(), 'x-ms-version': '2020-04-08' },
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
        'Content-Length': buffer.length,
      },
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
