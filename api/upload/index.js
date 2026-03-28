/**
 * api/upload/index.js
 * HTTP POST — receives a dashboard HTML file + metadata, writes both to
 * Azure Blob Storage, and updates the central registry.json.
 *
 * Expected JSON body:
 *   { filename: string, content: string, entry: Object }
 *
 * Required app settings:
 *   AZURE_STORAGE_CONNECTION_STRING  — blob storage connection string
 *   AZURE_STORAGE_BLOB_BASE_URL      — e.g. https://10fedhub.blob.core.windows.net
 */

const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER = 'dashboards';
const REGISTRY_BLOB = 'registry.json';

module.exports = async function (context, req) {
  // Only accept POST
  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method Not Allowed' };
    return;
  }

  const { filename, content, entry } = req.body || {};

  if (!filename || !content || !entry) {
    context.res = { status: 400, body: { error: 'Missing required fields: filename, content, entry.' } };
    return;
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const blobBaseUrl      = (process.env.AZURE_STORAGE_BLOB_BASE_URL || '').replace(/\/$/, '');

  if (!connectionString) {
    context.res = { status: 500, body: { error: 'Storage not configured on server.' } };
    return;
  }

  try {
    const serviceClient    = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient  = serviceClient.getContainerClient(CONTAINER);

    // ---- 1. Upload the HTML dashboard file ----
    const htmlClient = containerClient.getBlockBlobClient(filename);
    const htmlBuffer = Buffer.from(content, 'utf-8');
    await htmlClient.upload(htmlBuffer, htmlBuffer.length, {
      blobHTTPHeaders: { blobContentType: 'text/html; charset=utf-8' }
    });

    // ---- 2. Read existing registry (or start fresh) ----
    const registryClient = containerClient.getBlockBlobClient(REGISTRY_BLOB);
    let registry = [];
    try {
      const download = await registryClient.download(0);
      const text = await streamToString(download.readableStreamBody);
      registry = JSON.parse(text);
    } catch {
      // registry.json doesn't exist yet — start with empty array
    }

    // ---- 3. Upsert entry (remove old version if re-publishing same id) ----
    const blobUrl = blobBaseUrl ? `${blobBaseUrl}/${CONTAINER}/${filename}` : '';
    const fullEntry = { ...entry, blobUrl };

    registry = registry.filter(d => d.id !== fullEntry.id);
    registry.push(fullEntry);

    // ---- 4. Write updated registry back ----
    const registryJson   = JSON.stringify(registry, null, 2) + '\n';
    const registryBuffer = Buffer.from(registryJson, 'utf-8');
    await registryClient.upload(registryBuffer, registryBuffer.length, {
      blobHTTPHeaders: { blobContentType: 'application/json' }
    });

    context.res = {
      status: 200,
      body: { success: true, id: fullEntry.id, blobUrl }
    };

  } catch (err) {
    context.log.error('[upload] Error:', err.message);
    context.res = {
      status: 500,
      body: { error: err.message || 'Upload failed.' }
    };
  }
};

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
