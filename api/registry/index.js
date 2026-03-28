/**
 * api/registry/index.js
 * HTTP GET — returns the dashboard registry from Azure Blob Storage.
 * Returns [] if registry.json doesn't exist yet.
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME  — e.g. 10fedhub
 *   AZURE_STORAGE_SAS_TOKEN     — account SAS token (no leading ?)
 */

const https = require('https');

const CONTAINER    = 'dashboards';
const REGISTRY_BLOB = 'registry.json';

module.exports = async function (context, req) {
  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

  if (!account || !sasToken) {
    context.res = { status: 500, body: { error: 'Storage not configured on server.' } };
    return;
  }

  try {
    const host = `${account}.blob.core.windows.net`;
    const res  = await blobGet(host, `/${CONTAINER}/${REGISTRY_BLOB}?${sasToken}`);

    if (res.statusCode === 404) {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: [] };
      return;
    }

    if (res.statusCode !== 200) {
      throw new Error(`Failed to load registry: ${res.statusCode}`);
    }

    const registry = JSON.parse(res.body);
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: registry
    };

  } catch (err) {
    context.log.error('[registry]', err.message);
    context.res = { status: 500, body: { error: err.message } };
  }
};

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
