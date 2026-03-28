/**
 * api/delete/index.js
 * HTTP POST — deletes a dashboard HTML blob and removes its entry from registry.json.
 *
 * Expected JSON body: { id: string, filename: string }
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME
 *   AZURE_STORAGE_SAS_TOKEN
 */

const https = require('https');

const CONTAINER     = 'dashboards';
const REGISTRY_BLOB = 'registry.json';

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method Not Allowed' };
    return;
  }

  const { id, filename } = req.body || {};
  if (!id || !filename) {
    context.res = { status: 400, body: { error: 'Missing required fields: id, filename.' } };
    return;
  }

  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

  if (!account || !sasToken) {
    context.res = { status: 500, body: { error: 'Storage not configured on server.' } };
    return;
  }

  try {
    const host = `${account}.blob.core.windows.net`;

    // ---- 1. Delete the HTML blob ----
    const delRes = await blobDelete(host, `/${CONTAINER}/${filename}?${sasToken}`);
    // 404 is fine — blob may already be gone
    if (delRes.statusCode >= 300 && delRes.statusCode !== 404) {
      throw new Error(`Blob delete failed: ${delRes.statusCode} — ${delRes.body}`);
    }

    // ---- 2. Read registry ----
    const getRes = await blobGet(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`);
    if (getRes.statusCode !== 200) {
      // Registry doesn't exist — nothing more to do
      context.res = { status: 200, body: { success: true } };
      return;
    }

    let registry = [];
    try { registry = JSON.parse(getRes.body); } catch { registry = []; }

    // ---- 3. Remove entry ----
    registry = registry.filter(d => d.id !== id);

    // ---- 4. Write registry back ----
    const registryBuffer = Buffer.from(JSON.stringify(registry, null, 2) + '\n', 'utf-8');
    const regRes = await blobPut(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`, registryBuffer, 'application/json');
    if (regRes.statusCode >= 300) {
      throw new Error(`Registry update failed: ${regRes.statusCode} — ${regRes.body}`);
    }

    context.res = { status: 200, body: { success: true } };

  } catch (err) {
    context.log.error('[delete]', err.message);
    context.res = { status: 500, body: { error: err.message } };
  }
};

// ---- Helpers -----------------------------------------------

function blobDelete(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method: 'DELETE',
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

function blobGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method: 'GET',
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
    const req = https.request({ hostname: host, path, method: 'PUT',
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
