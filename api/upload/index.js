/**
 * api/upload/index.js
 * HTTP POST — uploads a dashboard HTML file to Azure Blob Storage, extracts
 * the embedded hub config (if present), validates it, and updates both
 * registry.json (legacy flat list) and index.json (new per-dashboard structure).
 *
 * ── Request body ──────────────────────────────────────────────────────
 *   filename  — e.g. "my-dashboard.html"
 *   content   — full HTML string
 *   entry     — metadata object (id, title, description, category, author, …)
 *
 * ── Hub-compatible config extraction (Features 1, 2, 8) ──────────────
 * If the HTML contains:
 *   <script id="dashboard-hub-config" type="application/json">{ ... }</script>
 * the server parses and validates it. A valid config must include:
 *   version, datasetId, queries (non-empty array), visualBindings (non-empty array)
 * If a config tag is present but invalid the upload is rejected (Feature 8).
 * If no config tag is present the upload proceeds without config extraction.
 *
 * ── Blob layout written (Feature 2) ──────────────────────────────────
 *   /dashboards/{filename}              — flat HTML (legacy viewer path)
 *   /dashboards/{id}/dashboard.html     — HTML in new per-dashboard folder
 *   /dashboards/{id}/config.json        — extracted hub config (if valid)
 *   /dashboards/{id}/metadata.json      — initial refresh metadata stub
 *   /dashboards/registry.json           — flat registry (existing)
 *   /dashboards/index.json              — extended registry with config metadata
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_SAS_TOKEN
 */

const https = require('https');

const CONTAINER      = 'dashboards';
const REGISTRY_BLOB  = 'registry.json';
const INDEX_BLOB     = 'index.json';
const CONFIG_VERSION = '1.0';

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method Not Allowed' };
    return;
  }

  const { filename, content, entry } = req.body || {};
  if (!filename || !content || !entry) {
    context.res = { status: 400, body: { error: 'Missing required fields: filename, content, entry.' } };
    return;
  }

  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

  if (!account || !sasToken) {
    context.res = { status: 500, body: { error: 'Storage not configured on server.' } };
    return;
  }

  // ── 1. Extract embedded hub config (Feature 1) ─────────────────────
  let hubConfig = null;
  const configMatch = content.match(
    /<script[^>]+id=["']dashboard-hub-config["'][^>]*>([\s\S]*?)<\/script>/i
  );

  if (configMatch) {
    try {
      hubConfig = JSON.parse(configMatch[1].trim());
    } catch (parseErr) {
      context.res = {
        status: 400,
        body: {
          error: 'Dashboard is not Hub-compatible',
          detail: `<script id="dashboard-hub-config"> contains invalid JSON: ${parseErr.message}`,
        },
      };
      return;
    }

    // ── 2. Validate config schema (Feature 8) ──────────────────────
    const missing = [];
    if (!hubConfig.version)                               missing.push('version');
    if (!hubConfig.datasetId)                             missing.push('datasetId');
    if (!Array.isArray(hubConfig.queries) || !hubConfig.queries.length)        missing.push('queries');
    if (!Array.isArray(hubConfig.visualBindings) || !hubConfig.visualBindings.length) missing.push('visualBindings');

    if (missing.length) {
      context.res = {
        status: 400,
        body: {
          error: 'Dashboard is not Hub-compatible',
          detail: `dashboard-hub-config is missing required fields: ${missing.join(', ')}`,
        },
      };
      return;
    }

    // Version compatibility check (Feature 13)
    const majorVersion = parseInt(String(hubConfig.version).split('.')[0]);
    if (majorVersion > 1) {
      context.res = {
        status: 400,
        body: {
          error: 'Dashboard is not Hub-compatible',
          detail: `Config version ${hubConfig.version} is not supported by this Hub (supports ≤ 1.x).`,
        },
      };
      return;
    }
  }

  const host     = `${account}.blob.core.windows.net`;
  const blobBase = `https://${host}/${CONTAINER}`;
  const id       = entry.id || filename.replace(/\.html$/, '');
  const now      = new Date().toISOString();

  try {
    const htmlBuffer = Buffer.from(content, 'utf-8');

    // ── 3a. Legacy flat HTML upload (keeps existing viewer path working) ─
    const flatUpload = await blobPut(
      host, `/${CONTAINER}/${filename}?${sasToken}`, htmlBuffer, 'text/html; charset=utf-8'
    );
    if (flatUpload.statusCode >= 300) {
      throw new Error(`HTML blob upload failed: ${flatUpload.statusCode} — ${flatUpload.body}`);
    }

    // ── 3b. New per-dashboard folder uploads (Feature 2) ─────────────
    await blobPut(
      host, `/${CONTAINER}/${id}/dashboard.html?${sasToken}`, htmlBuffer, 'text/html; charset=utf-8'
    );

    if (hubConfig) {
      await blobPut(
        host,
        `/${CONTAINER}/${id}/config.json?${sasToken}`,
        Buffer.from(JSON.stringify(hubConfig, null, 2), 'utf-8'),
        'application/json'
      );
    }

    // Write initial metadata stub
    const initMeta = {
      lastRefreshUtc:       null,
      lastRefreshStatus:    null,
      lastRefreshDurationMs: null,
      hubCompatible:        Boolean(hubConfig),
      uploadedUtc:          now,
    };
    await blobPut(
      host,
      `/${CONTAINER}/${id}/metadata.json?${sasToken}`,
      Buffer.from(JSON.stringify(initMeta, null, 2), 'utf-8'),
      'application/json'
    );

    // ── 4. Update flat registry.json (legacy) ─────────────────────────
    let registry = [];
    const regRes = await blobGet(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`);
    if (regRes.statusCode === 200) {
      try { registry = JSON.parse(regRes.body); } catch { registry = []; }
    }

    const blobUrl   = `${blobBase}/${filename}`;
    const fullEntry = { ...entry, blobUrl };
    registry        = registry.filter(d => d.id !== fullEntry.id);
    registry.push(fullEntry);

    await blobPut(
      host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`,
      Buffer.from(JSON.stringify(registry, null, 2) + '\n', 'utf-8'),
      'application/json'
    );

    // ── 5. Update index.json (Feature 11) ─────────────────────────────
    let index = [];
    const idxRes = await blobGet(host, `/${CONTAINER}/${INDEX_BLOB}?${sasToken}`);
    if (idxRes.statusCode === 200) {
      try { index = JSON.parse(idxRes.body); } catch { index = []; }
    }

    const indexEntry = {
      dashboardId:   id,
      title:         entry.title         || '',
      description:   entry.description   || '',
      category:      entry.category      || '',
      author:        entry.author        || '',
      tags:          entry.tags          || [],
      filename,
      blobUrl,
      createdUtc:    entry.dateAdded ? new Date(entry.dateAdded).toISOString() : now,
      uploadedUtc:   now,
      lastRefreshUtc: null,
      hubCompatible: Boolean(hubConfig),
      datasetId:     hubConfig?.datasetId   || entry.dataConnection?.datasetId   || null,
      workspaceId:   hubConfig?.workspaceId || entry.dataConnection?.workspaceId || null,
      queryCount:    hubConfig?.queries?.length ?? entry.dataConnection?.queries?.length ?? 0,
    };

    index = index.filter(d => d.dashboardId !== id);
    index.push(indexEntry);

    await blobPut(
      host, `/${CONTAINER}/${INDEX_BLOB}?${sasToken}`,
      Buffer.from(JSON.stringify(index, null, 2) + '\n', 'utf-8'),
      'application/json'
    );

    context.res = {
      status: 200,
      body: {
        success:       true,
        id:            fullEntry.id,
        blobUrl,
        hubCompatible: Boolean(hubConfig),
        configStored:  Boolean(hubConfig),
      },
    };

  } catch (err) {
    context.log.error('[upload]', err.message);
    context.res = { status: 500, body: { error: err.message } };
  }
};

// ── Helpers ───────────────────────────────────────────────────────────
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
