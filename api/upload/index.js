/**
 * api/upload/index.js
 * HTTP POST — uploads a dashboard package to Azure Blob Storage.
 *
 * ── Request body (new two-file format — Features 1-4) ─────────────────
 *   htmlContent    — full HTML string
 *   htmlFilename   — e.g. "dashboard.html"
 *   configContent  — dashboard.config.json string
 *   configFilename — e.g. "dashboard.config.json"
 *   entry          — metadata object (title, description, category, author, …)
 *
 * ── Request body (legacy single-file format — backward compat) ────────
 *   filename  — e.g. "my-dashboard.html"
 *   content   — full HTML string
 *   entry     — metadata object
 *
 * ── Validation for new format (Features 2, 3) ─────────────────────────
 *   Config: version, dashboardId, title, dataSource.workspaceId/datasetId,
 *           queries[] (engine, language, text), visualBindings[], refresh.mode,
 *           preview.enabled; max 10 queries; no duplicate queryIds;
 *           engine must be "powerbi-executeQueries", language must be "dax"
 *   HTML:   must contain window.dashboardHub, .updateData, .showLoading, .showError;
 *           max 5 MB; no embedded credentials/tokens
 *
 * ── Blob layout written (Feature 4) ──────────────────────────────────
 *   New format:
 *     /dashboards/{dashboardId}/dashboard.html
 *     /dashboards/{dashboardId}/dashboard.config.json
 *     /dashboards/{dashboardId}/dashboard.metadata.json
 *   Legacy:
 *     /dashboards/{filename}           (flat path — keeps old viewer working)
 *     /dashboards/{id}/dashboard.html
 *     /dashboards/{id}/config.json
 *     /dashboards/{id}/metadata.json
 *   Shared:
 *     /dashboards/registry.json
 *     /dashboards/index.json
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

  const body = req.body || {};

  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

  if (!account || !sasToken) {
    context.res = { status: 500, body: { error: 'Storage not configured on server.' } };
    return;
  }

  const host = `${account}.blob.core.windows.net`;

  // ── Route: new two-file format vs. legacy single-file format ───────────
  if (body.htmlContent !== undefined || body.configContent !== undefined) {
    return handleNewFormatUpload(context, body, host, sasToken);
  }
  return handleLegacyUpload(context, body, host, sasToken);
};

// ══════════════════════════════════════════════════════════════════════════
// NEW FORMAT: htmlContent + configContent (Features 1–5, 16)
// ══════════════════════════════════════════════════════════════════════════

async function handleNewFormatUpload(context, body, host, sasToken) {
  const { htmlContent, htmlFilename, configContent, configFilename, entry } = body;

  // ── Feature 1: Both files required ──────────────────────────────────────
  if (!htmlContent || !configContent || !entry) {
    context.res = {
      status: 400,
      body: { error: 'Dashboard package is incomplete or invalid.', detail: 'htmlContent, configContent, and entry are all required.' },
    };
    return;
  }

  // HTML size limit: 5 MB
  if (Buffer.byteLength(htmlContent, 'utf-8') > 5 * 1024 * 1024) {
    context.res = { status: 400, body: { error: 'Dashboard package is incomplete or invalid.', detail: 'HTML file exceeds 5 MB limit.' } };
    return;
  }

  // ── Parse config JSON ────────────────────────────────────────────────────
  let config;
  try {
    config = JSON.parse(configContent);
  } catch (parseErr) {
    context.res = {
      status: 400,
      body: { error: 'Dashboard package is incomplete or invalid.', detail: `Config JSON is not valid JSON: ${parseErr.message}` },
    };
    return;
  }

  // ── Feature 2: Config validation ────────────────────────────────────────
  const configErrors = validateNewConfigSchema(config);
  if (configErrors.length) {
    context.res = {
      status: 400,
      body: { error: 'Dashboard package is incomplete or invalid.', detail: configErrors.join(' | ') },
    };
    return;
  }

  // ── Feature 3: HTML validation ───────────────────────────────────────────
  const htmlErrors = validateHtmlHooks(htmlContent);
  if (htmlErrors.length) {
    context.res = {
      status: 400,
      body: { error: 'Dashboard package is incomplete or invalid.', detail: htmlErrors.join(' | ') },
    };
    return;
  }

  // ── Feature 3: Credential scan ───────────────────────────────────────────
  const credErrors = scanForCredentials(htmlContent, configContent);
  if (credErrors.length) {
    context.res = {
      status: 400,
      body: { error: 'Dashboard package is incomplete or invalid.', detail: credErrors.join(' | ') },
    };
    return;
  }

  const dashboardId = config.dashboardId;
  if (entry.id && entry.id !== dashboardId) {
    context.res = {
      status: 400,
      body: { error: 'Dashboard package is incomplete or invalid.', detail: `Cross-file identity mismatch: entry.id "${entry.id}" must match dashboardId "${dashboardId}".` },
    };
    return;
  }
  const id          = dashboardId;
  const now         = new Date().toISOString();
  const blobBase    = `https://${host}/${CONTAINER}`;
  const canonicalFilename = `${dashboardId}/dashboard.html`;
  const canonicalBlobUrl = `${blobBase}/${canonicalFilename}`;

  try {
    const htmlBuffer   = Buffer.from(htmlContent,   'utf-8');
    const configBuffer = Buffer.from(JSON.stringify(config, null, 2), 'utf-8');

    // ── Feature 4: Store artifacts under /dashboards/{dashboardId}/ ─────────
    await Promise.all([
      blobPut(host, `/${CONTAINER}/${dashboardId}/dashboard.html?${sasToken}`,        htmlBuffer,   'text/html; charset=utf-8'),
      blobPut(host, `/${CONTAINER}/${dashboardId}/dashboard.config.json?${sasToken}`, configBuffer, 'application/json'),
    ]);

    // ── Feature 5: Initial metadata (Feature 10 will update on refresh) ─────
    const initMeta = {
      dashboardId,
      slug:                  config.slug || dashboardId,
      title:                 config.title,
      category:              config.category               || entry.category || '',
      owner:                 config.owner || { name: entry.author || '', email: '' },
      workspaceId:           config.dataSource.workspaceId,
      datasetId:             config.dataSource.datasetId,
      datasetName:           config.dataSource.datasetName || '',
      createdUtc:            config.createdUtc             || now,
      lastModifiedUtc:       config.lastModifiedUtc        || now,
      lastRefreshUtc:        null,
      lastRefreshStatus:     'never',
      lastRefreshDurationMs: null,
      uploadedUtc:           now,
      schemaVersion:         '1.0',
      configVersion:         config.version,
      queryCount:            config.queries.length,
      refreshMode:           config.refresh?.mode || 'hub-managed',
      previewEnabled:        Boolean(config.preview?.enabled)
    };
    await blobPut(
      host,
      `/${CONTAINER}/${dashboardId}/dashboard.metadata.json?${sasToken}`,
      Buffer.from(JSON.stringify(initMeta, null, 2), 'utf-8'),
      'application/json'
    );

    // Also keep a flat copy of the HTML for the legacy viewer path (blobUrl compat)
    const flatFilename = htmlFilename || `${dashboardId}.html`;
    await blobPut(host, `/${CONTAINER}/${flatFilename}?${sasToken}`, htmlBuffer, 'text/html; charset=utf-8');

    const legacyBlobUrl = `${blobBase}/${flatFilename}`;

    // ── Update registry.json (legacy flat list) ──────────────────────────────
    let registry = [];
    const regRes = await blobGet(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`);
    if (regRes.statusCode === 200) {
      try { registry = JSON.parse(regRes.body); } catch { registry = []; }
    }
    const fullEntry = {
      ...entry,
      id,
      dashboardId,
      slug: config.slug || dashboardId,
      owner: config.owner || null,
      blobUrl: canonicalBlobUrl,
      legacyBlobUrl,
      filename: canonicalFilename,
      workspaceId: config.dataSource.workspaceId,
      datasetId: config.dataSource.datasetId,
      datasetName: config.dataSource.datasetName || '',
      queryCount: config.queries.length,
      lastModifiedUtc: config.lastModifiedUtc || now,
      lastRefreshUtc: null,
      lastRefreshStatus: 'never',
      hubCompatible: true
    };
    registry = registry.filter(d => d.id !== id);
    registry.push(fullEntry);
    await blobPut(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`,
      Buffer.from(JSON.stringify(registry, null, 2) + '\n', 'utf-8'), 'application/json');

    // ── Update index.json (Feature 4) ───────────────────────────────────────
    let index = [];
    const idxRes = await blobGet(host, `/${CONTAINER}/${INDEX_BLOB}?${sasToken}`);
    if (idxRes.statusCode === 200) {
      try { index = JSON.parse(idxRes.body); } catch { index = []; }
    }
    const indexEntry = {
      dashboardId,
      title:          config.title           || entry.title       || '',
      description:    config.description     || entry.description || '',
      category:       config.category        || entry.category    || '',
      author:         entry.author           || '',
      tags:           entry.tags             || [],
      owner:          config.owner || null,
      slug:           config.slug || dashboardId,
      filename:       canonicalFilename,
      blobUrl:        canonicalBlobUrl,
      legacyBlobUrl,
      createdUtc:     config.createdUtc      || now,
      lastModifiedUtc: config.lastModifiedUtc || now,
      uploadedUtc:    now,
      lastRefreshUtc: null,
      lastRefreshStatus: 'never',
      schemaVersion:  '1.0',
      configVersion:  config.version,
      workspaceId:    config.dataSource.workspaceId,
      datasetId:      config.dataSource.datasetId,
      datasetName:    config.dataSource.datasetName || '',
      queryCount:     config.queries.length,
      refreshMode:    config.refresh?.mode || 'hub-managed',
      previewEnabled: Boolean(config.preview?.enabled),
      hubCompatible:  true
    };
    // Feature 16: upsert — replace if dashboardId already exists
    index = index.filter(d => d.dashboardId !== dashboardId);
    index.push(indexEntry);
    await blobPut(host, `/${CONTAINER}/${INDEX_BLOB}?${sasToken}`,
      Buffer.from(JSON.stringify(index, null, 2) + '\n', 'utf-8'), 'application/json');

    context.res = {
      status: 200,
      body: {
        success: true,
        id: dashboardId,
        blobUrl: canonicalBlobUrl,
        legacyBlobUrl,
        schemaVersion: '1.0',
        queryCount: config.queries.length
      },
    };

  } catch (err) {
    context.log?.error('[upload/new]', err.message);
    context.res = { status: 500, body: { error: err.message } };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// LEGACY FORMAT: filename + content (backward compat for old single-file uploads)
// ══════════════════════════════════════════════════════════════════════════

async function handleLegacyUpload(context, body, host, sasToken) {
  const { filename, content, entry } = body;
  if (!filename || !content || !entry) {
    context.res = { status: 400, body: { error: 'Missing required fields: filename, content, entry.' } };
    return;
  }

  const blobBase = `https://${host}/${CONTAINER}`;
  const id       = entry.id || filename.replace(/\.html$/, '');
  const now      = new Date().toISOString();

  // Extract embedded hub config (legacy approach)
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
        body: { error: 'Dashboard is not Hub-compatible', detail: `<script id="dashboard-hub-config"> contains invalid JSON: ${parseErr.message}` },
      };
      return;
    }

    const missing = [];
    if (!hubConfig.version)                                                      missing.push('version');
    if (!hubConfig.datasetId)                                                    missing.push('datasetId');
    if (!Array.isArray(hubConfig.queries)       || !hubConfig.queries.length)   missing.push('queries');
    if (!Array.isArray(hubConfig.visualBindings) || !hubConfig.visualBindings.length) missing.push('visualBindings');

    if (missing.length) {
      context.res = {
        status: 400,
        body: { error: 'Dashboard is not Hub-compatible', detail: `dashboard-hub-config is missing: ${missing.join(', ')}` },
      };
      return;
    }

    const majorVersion = parseInt(String(hubConfig.version).split('.')[0]);
    if (majorVersion > 1) {
      context.res = {
        status: 400,
        body: { error: 'Dashboard is not Hub-compatible', detail: `Config version ${hubConfig.version} not supported (max 1.x).` },
      };
      return;
    }
  }

  try {
    const htmlBuffer = Buffer.from(content, 'utf-8');

    const flatUpload = await blobPut(host, `/${CONTAINER}/${filename}?${sasToken}`, htmlBuffer, 'text/html; charset=utf-8');
    if (flatUpload.statusCode >= 300) throw new Error(`HTML blob upload failed: ${flatUpload.statusCode}`);

    await blobPut(host, `/${CONTAINER}/${id}/dashboard.html?${sasToken}`, htmlBuffer, 'text/html; charset=utf-8');

    if (hubConfig) {
      await blobPut(host, `/${CONTAINER}/${id}/config.json?${sasToken}`,
        Buffer.from(JSON.stringify(hubConfig, null, 2), 'utf-8'), 'application/json');
    }

    const initMeta = {
      lastRefreshUtc: null, lastRefreshStatus: null, lastRefreshDurationMs: null,
      hubCompatible: Boolean(hubConfig), uploadedUtc: now,
    };
    await blobPut(host, `/${CONTAINER}/${id}/metadata.json?${sasToken}`,
      Buffer.from(JSON.stringify(initMeta, null, 2), 'utf-8'), 'application/json');

    // Update registry.json
    let registry = [];
    const regRes = await blobGet(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`);
    if (regRes.statusCode === 200) { try { registry = JSON.parse(regRes.body); } catch { registry = []; } }
    const blobUrl   = `${blobBase}/${filename}`;
    const fullEntry = { ...entry, blobUrl };
    registry = registry.filter(d => d.id !== fullEntry.id);
    registry.push(fullEntry);
    await blobPut(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`,
      Buffer.from(JSON.stringify(registry, null, 2) + '\n', 'utf-8'), 'application/json');

    // Update index.json
    let index = [];
    const idxRes = await blobGet(host, `/${CONTAINER}/${INDEX_BLOB}?${sasToken}`);
    if (idxRes.statusCode === 200) { try { index = JSON.parse(idxRes.body); } catch { index = []; } }
    const indexEntry = {
      dashboardId: id, title: entry.title || '', description: entry.description || '',
      category: entry.category || '', author: entry.author || '', tags: entry.tags || [],
      filename, blobUrl, createdUtc: entry.dateAdded ? new Date(entry.dateAdded).toISOString() : now,
      uploadedUtc: now, lastRefreshUtc: null, hubCompatible: Boolean(hubConfig),
      datasetId: hubConfig?.datasetId || entry.dataConnection?.datasetId || null,
      workspaceId: hubConfig?.workspaceId || entry.dataConnection?.workspaceId || null,
      queryCount: hubConfig?.queries?.length ?? entry.dataConnection?.queries?.length ?? 0,
    };
    index = index.filter(d => d.dashboardId !== id);
    index.push(indexEntry);
    await blobPut(host, `/${CONTAINER}/${INDEX_BLOB}?${sasToken}`,
      Buffer.from(JSON.stringify(index, null, 2) + '\n', 'utf-8'), 'application/json');

    context.res = {
      status: 200,
      body: { success: true, id: fullEntry.id, blobUrl, hubCompatible: Boolean(hubConfig), configStored: Boolean(hubConfig) },
    };
  } catch (err) {
    context.log?.error('[upload/legacy]', err.message);
    context.res = { status: 500, body: { error: err.message } };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Validation helpers (Features 2, 3)
// ══════════════════════════════════════════════════════════════════════════

// Feature 2: Validate new-schema config JSON. Returns array of error strings.
function validateNewConfigSchema(config) {
  const errors = [];
  if (!config.version)                                                        errors.push('Missing: version');
  if (!config.dashboardId)                                                    errors.push('Missing: dashboardId');
  if (!config.slug)                                                           errors.push('Missing: slug');
  if (!config.title)                                                          errors.push('Missing: title');
  if (!config.description)                                                    errors.push('Missing: description');
  if (!config.category)                                                       errors.push('Missing: category');
  if (!config.owner)                                                          errors.push('Missing: owner');
  if (!config.createdUtc)                                                     errors.push('Missing: createdUtc');
  if (!config.lastModifiedUtc)                                                errors.push('Missing: lastModifiedUtc');
  if (!config.dataSource?.workspaceId)                                        errors.push('Missing: dataSource.workspaceId');
  if (!config.dataSource?.datasetId)                                          errors.push('Missing: dataSource.datasetId');
  if (!config.dataSource?.datasetName)                                        errors.push('Missing: dataSource.datasetName');
  if (config.dataSource?.type !== 'powerbi-semantic-model')                   errors.push(`dataSource.type must be "powerbi-semantic-model" (got "${config.dataSource?.type}")`);
  if (config.dataSource?.authMode !== 'hub-managed')                          errors.push(`dataSource.authMode must be "hub-managed" (got "${config.dataSource?.authMode}")`);
  if (!Array.isArray(config.queries) || !config.queries.length)               errors.push('Missing: queries (must be a non-empty array)');
  if (!Array.isArray(config.visualBindings) || !config.visualBindings.length) errors.push('Missing: visualBindings (must be a non-empty array)');
  if (!config.refresh?.mode)                                                  errors.push('Missing: refresh.mode');
  if (config.refresh?.mode && config.refresh.mode !== 'hub-managed')          errors.push(`refresh.mode must be "hub-managed" (got "${config.refresh.mode}")`);
  if (config.refresh?.minRefreshIntervalSeconds == null)                      errors.push('Missing: refresh.minRefreshIntervalSeconds');
  if (config.refresh?.timeoutSeconds == null)                                 errors.push('Missing: refresh.timeoutSeconds');
  if (config.preview?.enabled === undefined)                                  errors.push('Missing: preview.enabled');
  if (config.preview?.maxRows == null)                                        errors.push('Missing: preview.maxRows');
  if (config.preview?.timeoutSeconds == null)                                 errors.push('Missing: preview.timeoutSeconds');
  if (!config.security)                                                       errors.push('Missing: security');

  if (Array.isArray(config.queries)) {
    if (config.queries.length > 10) errors.push(`Query limit exceeded: ${config.queries.length} queries defined (max 10)`);
    const queryIds = new Set();
    config.queries.forEach((q, i) => {
      if (!q.queryId)                            errors.push(`queries[${i}]: missing queryId`);
      if (q.queryId && queryIds.has(q.queryId))  errors.push(`queries[${i}]: duplicate queryId "${q.queryId}"`);
      if (q.queryId) queryIds.add(q.queryId);
      if (q.engine !== 'powerbi-executeQueries') errors.push(`queries[${i}]: engine must be "powerbi-executeQueries" (got "${q.engine}")`);
      if (q.language !== 'dax')                  errors.push(`queries[${i}]: language must be "dax" (got "${q.language}")`);
      if (!q.text || !q.text.trim())             errors.push(`queries[${i}]: text (inline DAX) is required and must not be empty`);
      if (q.text && !/^\s*EVALUATE\b/i.test(q.text)) errors.push(`queries[${i}]: text must start with EVALUATE`);
    });
  }
  if (Array.isArray(config.visualBindings) && Array.isArray(config.queries)) {
    const validQueryIds = new Set(config.queries.map(q => q.queryId).filter(Boolean));
    config.visualBindings.forEach((binding, i) => {
      if (!binding.visualId) errors.push(`visualBindings[${i}]: missing visualId`);
      if (!binding.visualType) errors.push(`visualBindings[${i}]: missing visualType`);
      if (!binding.queryId) errors.push(`visualBindings[${i}]: missing queryId`);
      if (!binding.title) errors.push(`visualBindings[${i}]: missing title`);
      if (binding.queryId && !validQueryIds.has(binding.queryId)) {
        errors.push(`visualBindings[${i}]: queryId "${binding.queryId}" does not map to a defined query`);
      }
    });
  }
  return errors;
}

// Feature 3: Validate HTML contains required runtime interface hooks.
function validateHtmlHooks(html) {
  const errors = [];
  if (!/window\.dashboardHub\b|dashboardHub\s*=/.test(html))    errors.push('HTML missing: window.dashboardHub definition');
  if (!/\.updateData\b/.test(html))                              errors.push('HTML missing: window.dashboardHub.updateData()');
  if (!/\.showLoading\b/.test(html))                             errors.push('HTML missing: window.dashboardHub.showLoading()');
  if (!/\.showError\b/.test(html))                               errors.push('HTML missing: window.dashboardHub.showError()');
  return errors;
}

// Feature 3: Scan for embedded credentials/tokens in either file.
function scanForCredentials(htmlContent, configContent) {
  const combined = htmlContent + '\n' + configContent;
  const patterns = [
    { re: /Bearer\s+[A-Za-z0-9._\-]{20,}/,           label: 'Bearer token' },
    { re: /client_secret\s*[:=]\s*["'][^"']{8,}/i,   label: 'client_secret' },
    { re: /access_token\s*[:=]\s*["'][^"']{8,}/i,    label: 'access_token' },
    { re: /refresh_token\s*[:=]\s*["'][^"']{8,}/i,   label: 'refresh_token' },
    { re: /password\s*[:=]\s*["'][^"']{4,}/i,         label: 'password' },
    { re: /["']eyJ[A-Za-z0-9._\-]{40,}["']/,         label: 'JWT token (eyJ…)' },
  ];
  return patterns
    .filter(p => p.re.test(combined))
    .map(p => `Credential detected: ${p.label} — remove all secrets before uploading`);
}

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
