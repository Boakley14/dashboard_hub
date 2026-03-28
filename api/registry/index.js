/**
 * api/registry/index.js
 * HTTP GET — returns the dashboard registry array from Blob Storage.
 * Returns [] if registry.json doesn't exist yet.
 *
 * Required app settings:
 *   AZURE_STORAGE_CONNECTION_STRING  — blob storage connection string
 */

const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER     = 'dashboards';
const REGISTRY_BLOB = 'registry.json';

module.exports = async function (context, req) {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    context.res = { status: 500, body: { error: 'Storage not configured on server.' } };
    return;
  }

  try {
    const serviceClient   = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = serviceClient.getContainerClient(CONTAINER);
    const blobClient      = containerClient.getBlockBlobClient(REGISTRY_BLOB);

    const download = await blobClient.download(0);
    const text     = await streamToString(download.readableStreamBody);
    const registry = JSON.parse(text);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: registry
    };

  } catch (err) {
    // If blob doesn't exist yet, return empty registry gracefully
    if (err.statusCode === 404 || err.code === 'BlobNotFound') {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: [] };
      return;
    }
    context.log.error('[registry] Error:', err.message);
    context.res = { status: 500, body: { error: err.message } };
  }
};

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
