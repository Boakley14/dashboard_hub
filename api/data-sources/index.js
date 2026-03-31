/**
 * api/data-sources/index.js
 * Hub-level global data source registry.
 *
 * GET    → return all registered data sources
 * POST   { source } → upsert a data source (matched by workspaceId+datasetId)
 * DELETE { id }     → remove a source; clears sourceId from any registry entries that reference it
 *
 * Storage:
 *   Container: dashboards
 *   Blob:      data-sources.json   (array of source objects)
 *   Blob:      registry.json       (modified on DELETE to clear dangling sourceIds)
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME
 *   AZURE_STORAGE_SAS_TOKEN
 *
 * Also exports autoMatchOrRegister() for use by api/update.
 */

const https = require('https');
const crypto = require('crypto');

const CONTAINER   = 'dashboards';
const DS_BLOB     = 'data-sources.json';
const REG_BLOB    = 'registry.json';

const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
};

// ── Main handler ────────────────────────────────────────────────────────────

module.exports = async function (context, req) {
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

  const host = `${account}.blob.core.windows.net`;

  try {
    // ── GET ─────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const sources = await readSources(host, sasToken);
      context.res = {
        status: 200,
        headers: { ...CORS, 'Cache-Control': 'no-store' },
        body: sources,
      };
      return;
    }

    // ── POST (upsert) ────────────────────────────────────────────
    if (req.method === 'POST') {
      const { source } = req.body || {};
      if (!source || !source.name) {
        context.res = { status: 400, headers: CORS, body: { error: 'Missing: source.name' } };
        return;
      }

      const sources = await readSources(host, sasToken);
      const result  = upsertSource(sources, source);
      await writeSources(host, sasToken, result.sources);

      context.res = {
        status: 200,
        headers: { ...CORS, 'Cache-Control': 'no-store' },
        body: { success: true, source: result.source, created: result.created },
      };
      return;
    }

    // ── DELETE ───────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) {
        context.res = { status: 400, headers: CORS, body: { error: 'Missing: id' } };
        return;
      }

      // Remove from data-sources
      const sources = await readSources(host, sasToken);
      const updated = sources.filter(s => s.id !== id);
      if (updated.length === sources.length) {
        context.res = { status: 404, headers: CORS, body: { error: `Source '${id}' not found.` } };
        return;
      }
      await writeSources(host, sasToken, updated);

      // Clear dangling sourceId references in registry.json
      await clearRegistrySourceId(host, sasToken, id);

      context.res = {
        status: 200,
        headers: { ...CORS, 'Cache-Control': 'no-store' },
        body: { success: true },
      };
      return;
    }

    context.res = { status: 405, headers: CORS, body: { error: 'Method Not Allowed' } };

  } catch (err) {
    context.log?.error('[data-sources]', err.message);
    context.res = { status: 500, headers: CORS, body: { error: err.message } };
  }
};

// ── Exported helper — called by api/update when dataConnection is present ──

/**
 * Given a `dataConnection` object from a registry entry, ensure the
 * connection's workspaceId+datasetId is registered in data-sources.json.
 * Returns the updated dataConnection with `sourceId` set.
 *
 * @param {Object} dataConnection
 * @param {string} account
 * @param {string} sasToken
 * @param {string} [createdBy]
 * @returns {Promise<Object>} updated dataConnection
 */
module.exports.autoMatchOrRegister = async function (dataConnection, account, sasToken, createdBy) {
  if (!dataConnection?.workspaceId || !dataConnection?.datasetId) return dataConnection;

  const host    = `${account}.blob.core.windows.net`;
  const sources = await readSources(host, sasToken);

  // Check for existing match
  const match = sources.find(
    s => s.workspaceId === dataConnection.workspaceId &&
         s.datasetId   === dataConnection.datasetId
  );

  if (match) {
    return { ...dataConnection, sourceId: match.id };
  }

  // Auto-register a new source
  const newSource = {
    name:        dataConnection.name || 'Unnamed Dataset',
    type:        'pbi-data',
    description: '',
    workspaceId: dataConnection.workspaceId,
    datasetId:   dataConnection.datasetId,
    endpoint:    dataConnection.endpoint || '/api/pbi-data',
    queries:     dataConnection.queries  || [],
    createdBy:   createdBy || 'system',
  };

  const result = upsertSource(sources, newSource);
  await writeSources(host, sasToken, result.sources);

  return { ...dataConnection, sourceId: result.source.id };
};

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Upsert a source into the list.
 * Match by workspaceId+datasetId (if provided); otherwise match by id.
 * Always generates a stable slug id from the name if not provided.
 */
function upsertSource(sources, incoming) {
  // Find existing by workspaceId+datasetId OR by id
  const idx = sources.findIndex(s =>
    (incoming.workspaceId && incoming.datasetId &&
     s.workspaceId === incoming.workspaceId && s.datasetId === incoming.datasetId) ||
    (incoming.id && s.id === incoming.id)
  );

  if (idx !== -1) {
    // Update existing — preserve id and createdAt
    const merged = {
      ...sources[idx],
      ...incoming,
      id:        sources[idx].id,
      createdAt: sources[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    const updated = [...sources];
    updated[idx] = merged;
    return { sources: updated, source: merged, created: false };
  }

  // Create new — generate a slug id from the name
  const newSource = {
    id:          _slugId(incoming.name),
    type:        'pbi-data',
    description: '',
    endpoint:    '/api/pbi-data',
    queries:     [],
    ...incoming,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  return { sources: [...sources, newSource], source: newSource, created: true };
}

/** Remove sourceId from all registry entries that reference a deleted source. */
async function clearRegistrySourceId(host, sasToken, sourceId) {
  const getRes = await blobGet(host, `/${CONTAINER}/${REG_BLOB}?${sasToken}`);
  if (getRes.statusCode !== 200) return;  // registry doesn't exist or inaccessible

  let registry = [];
  try { registry = JSON.parse(getRes.body); } catch { return; }

  let changed = false;
  registry = registry.map(entry => {
    if (entry.dataConnection?.sourceId === sourceId) {
      changed = true;
      const { sourceId: _removed, ...rest } = entry.dataConnection;
      return { ...entry, dataConnection: rest };
    }
    return entry;
  });

  if (!changed) return;

  const buf = Buffer.from(JSON.stringify(registry, null, 2) + '\n', 'utf-8');
  await blobPut(host, `/${CONTAINER}/${REG_BLOB}?${sasToken}`, buf, 'application/json');
}

async function readSources(host, sasToken) {
  const res = await blobGet(host, `/${CONTAINER}/${DS_BLOB}?${sasToken}`);
  if (res.statusCode === 404) return [];
  if (res.statusCode !== 200) throw new Error(`Failed to read data-sources.json: ${res.statusCode}`);
  try { return JSON.parse(res.body); } catch { return []; }
}

async function writeSources(host, sasToken, sources) {
  const buf = Buffer.from(JSON.stringify(sources, null, 2) + '\n', 'utf-8');
  const res = await blobPut(host, `/${CONTAINER}/${DS_BLOB}?${sasToken}`, buf, 'application/json');
  if (res.statusCode >= 300) throw new Error(`Failed to write data-sources.json: ${res.statusCode}`);
}

function _slugId(name) {
  const base = (name || 'source')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // Append a short random suffix to avoid collisions on same-name sources
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

// ── Blob helpers ────────────────────────────────────────────────────────────

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
