/**
 * api/registry/index.js
 * HTTP GET — returns the merged dashboard registry.
 *
 * Reads both registry.json (legacy flat list) and index.json (new extended
 * list written by the upload API). Entries in index.json take precedence over
 * same-ID entries in registry.json, enabling a smooth migration path where
 * old dashboards remain visible until re-uploaded.
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_SAS_TOKEN
 */

const https = require('https');

const CONTAINER    = 'dashboards';
const REGISTRY_BLOB = 'registry.json';
const INDEX_BLOB    = 'index.json';

module.exports = async function (context, req) {
  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

  if (!account || !sasToken) {
    context.res = { status: 500, body: { error: 'Storage not configured on server.' } };
    return;
  }

  try {
    const host = `${account}.blob.core.windows.net`;

    // Fetch both sources in parallel
    const [regRes, idxRes] = await Promise.all([
      blobGet(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`),
      blobGet(host, `/${CONTAINER}/${INDEX_BLOB}?${sasToken}`),
    ]);

    let legacy  = [];
    let indexed = [];

    if (regRes.statusCode === 200) {
      try { legacy  = JSON.parse(regRes.body); } catch { legacy  = []; }
    }
    if (idxRes.statusCode === 200) {
      try { indexed = JSON.parse(idxRes.body); } catch { indexed = []; }
    }

    // Merge: index.json entries win over registry.json for the same ID.
    // index.json uses dashboardId; registry.json uses id — normalise both.
    const indexedIds = new Set(indexed.map(e => e.dashboardId || e.id));
    const legacyOnly = legacy.filter(e => !indexedIds.has(e.id));

    // Normalise index entries to match the shape callers expect
    const normIndex = indexed.map(e => ({
      id:          e.dashboardId || e.id,
      dashboardId: e.dashboardId || e.id,
      slug:        e.slug        || e.dashboardId || e.id,
      title:       e.title       || '',
      description: e.description || '',
      category:    e.category    || '',
      author:      e.author      || '',
      owner:       e.owner       || null,
      tags:        e.tags        || [],
      filename:    e.filename    || '',
      blobUrl:     e.blobUrl     || '',
      legacyBlobUrl: e.legacyBlobUrl || '',
      dateAdded:   e.createdUtc  ? e.createdUtc.slice(0, 10) : '',
      // Extended fields (available to viewer/settings panel)
      datasetId:     e.datasetId     || null,
      workspaceId:   e.workspaceId   || null,
      datasetName:   e.datasetName   || '',
      queryCount:    e.queryCount    || 0,
      hubCompatible: e.hubCompatible || false,
      createdUtc:    e.createdUtc    || null,
      uploadedUtc:   e.uploadedUtc   || null,
      lastModifiedUtc: e.lastModifiedUtc || null,
      lastRefreshUtc: e.lastRefreshUtc || null,
      lastRefreshStatus: e.lastRefreshStatus || 'never',
      schemaVersion: e.schemaVersion || null,
      configVersion: e.configVersion || null,
      refreshMode: e.refreshMode || null,
      previewEnabled: Boolean(e.previewEnabled),
      packageType: e.packageType || (e.queryCount ? 'hub-managed' : 'html-only'),
    }));

    const merged = [...legacyOnly, ...normIndex];

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: merged,
    };

  } catch (err) {
    context.log.error('[registry]', err.message);
    context.res = { status: 500, body: { error: err.message } };
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
