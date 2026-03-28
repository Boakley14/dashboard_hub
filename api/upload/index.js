/**
 * api/upload/index.js
 * HTTP POST — uploads a dashboard HTML file to Azure Blob Storage and
 * updates registry.json. Uses only built-in Node.js https module.
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME  — e.g. 10fedhub
 *   AZURE_STORAGE_SAS_TOKEN     — account SAS token (no leading ?)
 */

const https = require('https');

const CONTAINER    = 'dashboards';
const REGISTRY_BLOB = 'registry.json';

module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method Not Allowed' };
    return;
  }

  const { filename, content, entry } = req.body || {};
  if (!filename || !content || !entry) {
    context.res = { status: 400, body: { error: 'Missing required fields.' } };
    return;
  }

  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

  if (!account || !sasToken) {
    context.res = { status: 500, body: { error: 'Storage not configured on server.' } };
    return;
  }

  try {
    const host     = `${account}.blob.core.windows.net`;
    const blobBase = `https://${host}/${CONTAINER}`;

    // ---- 1. Upload HTML file ----
    const htmlBuffer = Buffer.from(content, 'utf-8');
    const uploadRes  = await blobPut(host, `/${CONTAINER}/${filename}?${sasToken}`, htmlBuffer, 'text/html; charset=utf-8');
    if (uploadRes.statusCode >= 300) {
      throw new Error(`Blob upload failed: ${uploadRes.statusCode} — ${uploadRes.body}`);
    }

    // ---- 2. Read existing registry ----
    let registry = [];
    const getRes = await blobGet(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`);
    if (getRes.statusCode === 200) {
      try { registry = JSON.parse(getRes.body); } catch { registry = []; }
    }

    // ---- 3. Upsert entry ----
    const blobUrl   = `${blobBase}/${filename}`;
    const fullEntry = { ...entry, blobUrl };
    registry        = registry.filter(d => d.id !== fullEntry.id);
    registry.push(fullEntry);

    // ---- 4. Write registry back ----
    const registryBuffer = Buffer.from(JSON.stringify(registry, null, 2) + '\n', 'utf-8');
    const regRes = await blobPut(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`, registryBuffer, 'application/json');
    if (regRes.statusCode >= 300) {
      throw new Error(`Registry update failed: ${regRes.statusCode} — ${regRes.body}`);
    }

    context.res = { status: 200, body: { success: true, id: fullEntry.id, blobUrl } };

  } catch (err) {
    context.log.error('[upload]', err.message);
    context.res = { status: 500, body: { error: err.message } };
  }
};

// ---- Helpers -----------------------------------------------

function blobPut(host, path, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      path,
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-date':      new Date().toUTCString(),
        'x-ms-version':   '2020-04-08',
        'Content-Type':   contentType,
        'Content-Length': buffer.length
      }
    };
    const req = https.request(options, res => {
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
    const options = {
      hostname: host,
      path,
      method: 'GET',
      headers: {
        'x-ms-date':    new Date().toUTCString(),
        'x-ms-version': '2020-04-08'
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
