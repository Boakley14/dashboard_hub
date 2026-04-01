/**
 * api/dashboard-config/index.js
 * HTTP GET — returns the stored hub config and refresh metadata for a dashboard
 * (Features 4, 6, 7).
 *
 * ── Query params ──────────────────────────────────────────────────────
 *   dashboardId (required) — dashboard slug ID
 *
 * ── Response ──────────────────────────────────────────────────────────
 *   { dashboardId, config: {...}, metadata: {...}, fetchedAt }
 *   config  — parsed dashboard-hub-config JSON (null if not stored)
 *   metadata — { lastRefreshUtc, lastRefreshStatus, lastRefreshDurationMs }
 *              (null if no refresh has run yet)
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_SAS_TOKEN
 */

const https = require('https');

const CONTAINER = 'dashboards';
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type':                 'application/json',
};

module.exports = async function (context, req) {
  const dashboardId = req.query?.dashboardId;

  if (!dashboardId) {
    context.res = { status: 400, headers: CORS, body: { error: 'Missing required param: dashboardId' } };
    return;
  }

  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

  if (!account || !sasToken) {
    context.res = { status: 500, headers: CORS, body: { error: 'Storage not configured.' } };
    return;
  }

  const host = `${account}.blob.core.windows.net`;

  try {
    // Fetch config and metadata in parallel
    const [cfgRes, metaRes] = await Promise.all([
      blobGet(host, `/${CONTAINER}/${dashboardId}/config.json?${sasToken}`),
      blobGet(host, `/${CONTAINER}/${dashboardId}/metadata.json?${sasToken}`),
    ]);

    let config   = null;
    let metadata = null;

    if (cfgRes.statusCode === 200) {
      try { config = JSON.parse(cfgRes.body); } catch { /* malformed */ }
    }
    if (metaRes.statusCode === 200) {
      try { metadata = JSON.parse(metaRes.body); } catch { /* malformed */ }
    }

    context.res = {
      status: 200, headers: CORS,
      body: { dashboardId, config, metadata, fetchedAt: new Date().toISOString() },
    };

  } catch (err) {
    context.log?.error('[dashboard-config]', err.message);
    context.res = { status: 500, headers: CORS, body: { error: err.message } };
  }
};

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
