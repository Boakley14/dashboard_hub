/**
 * api/pbi-detect/index.js
 * HTTP GET — auto-detects the Power BI dataset linked to a dashboard HTML file.
 *
 * Fetches the HTML embed file (from blob storage or a direct URL), parses it
 * for a Power BI reportEmbed / rdlEmbed URL, extracts the reportId and groupId,
 * then calls the Power BI REST API to resolve the associated datasetId.
 *
 * Query params (at least one required):
 *   filename — blob filename (e.g. "lodestar-ops.html") stored in the dashboards container
 *   blobUrl  — full HTTPS URL to the HTML file (overrides filename if both provided)
 *
 * Required app settings:
 *   POWERBI_TENANT_ID
 *   POWERBI_CLIENT_ID
 *   POWERBI_CLIENT_SECRET
 *   AZURE_STORAGE_ACCOUNT_NAME  (required when using filename param)
 *   AZURE_STORAGE_SAS_TOKEN     (required when using filename param)
 */

const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type':                 'application/json',
};

// Match reportId before groupId
const RE_RPT_FIRST  = /https?:\/\/app\.powerbi\.com\/(?:reportEmbed|rdlEmbed)[^"' <\r\n]*reportId=([0-9a-f-]{36})[^"' <\r\n]*groupId=([0-9a-f-]{36})/i;
// Match groupId before reportId
const RE_GRP_FIRST  = /https?:\/\/app\.powerbi\.com\/(?:reportEmbed|rdlEmbed)[^"' <\r\n]*groupId=([0-9a-f-]{36})[^"' <\r\n]*reportId=([0-9a-f-]{36})/i;

module.exports = async function (context, req) {
  const { filename, blobUrl } = req.query ?? {};

  if (!filename && !blobUrl) {
    context.res = { status: 400, headers: CORS, body: { error: 'Missing query param: filename or blobUrl' } };
    return;
  }

  const tenantId     = process.env.POWERBI_TENANT_ID;
  const clientId     = process.env.POWERBI_CLIENT_ID;
  const clientSecret = process.env.POWERBI_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    context.res = { status: 500, headers: CORS, body: { error: 'Power BI credentials not configured.' } };
    return;
  }

  try {
    // ---- 1. Build fetch URL ------------------------------------
    let fetchUrl;
    if (blobUrl) {
      fetchUrl = blobUrl;
    } else {
      const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
      const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
      if (!account || !sasToken) {
        context.res = { status: 500, headers: CORS, body: { error: 'Storage not configured on server.' } };
        return;
      }
      fetchUrl = `https://${account}.blob.core.windows.net/dashboards/${encodeURIComponent(filename)}?${sasToken}`;
    }

    // ---- 2. Fetch the HTML file --------------------------------
    const html = await fetchText(fetchUrl);

    // ---- 3. Parse Power BI embed URL --------------------------
    let reportId, workspaceId;

    const m1 = RE_RPT_FIRST.exec(html);
    if (m1) {
      reportId    = m1[1];
      workspaceId = m1[2];
    } else {
      const m2 = RE_GRP_FIRST.exec(html);
      if (m2) {
        workspaceId = m2[1];
        reportId    = m2[2];
      }
    }

    if (!reportId || !workspaceId) {
      context.res = {
        status:  404,
        headers: CORS,
        body:    { error: 'No Power BI embed URL found in this file.' },
      };
      return;
    }

    // ---- 4. Get Power BI access token -------------------------
    const token = await getAccessToken(tenantId, clientId, clientSecret);

    // ---- 5. Resolve report → dataset via PBI REST API ---------
    const reportRes = await pbiRequest(token, 'GET',
      `/v1.0/myorg/groups/${workspaceId}/reports/${reportId}`);

    if (reportRes.status !== 200) {
      context.res = {
        status:  502,
        headers: CORS,
        body:    { error: `Power BI API error ${reportRes.status}: ${reportRes.body?.message ?? ''}` },
      };
      return;
    }

    const report = reportRes.body;
    context.res = {
      status:  200,
      headers: CORS,
      body: {
        reportId,
        reportName:         report.name        ?? '',
        workspaceId,
        datasetId:          report.datasetId   ?? '',
        // datasetWorkspaceId is present when the dataset lives in a different workspace
        datasetWorkspaceId: report.datasetWorkspaceId ?? workspaceId,
      },
    };

  } catch (err) {
    context.log?.error('[pbi-detect]', err.message);
    context.res = { status: 500, headers: CORS, body: { error: err.message } };
  }
};

// ---- Helpers -----------------------------------------------

/** Fetch a URL and return the response body as a UTF-8 string. */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { 'x-ms-date': new Date().toUTCString(), 'x-ms-version': '2020-04-08' },
    };
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} fetching file`));
        } else {
          resolve(Buffer.concat(chunks).toString('utf-8'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Generic HTTPS request helper. */
function request(opts, body) {
  return new Promise((resolve, reject) => {
    const buf     = body ? Buffer.from(body) : null;
    const reqOpts = { ...opts };
    if (buf) reqOpts.headers = { ...reqOpts.headers, 'Content-Length': buf.length };
    const req = https.request(reqOpts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (buf) req.write(buf);
    req.end();
  });
}

/** Authenticated Power BI REST API call. */
function pbiRequest(token, method, path) {
  return request({
    hostname: 'api.powerbi.com',
    path,
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

/** Acquire an OAuth2 token via client credentials flow. */
async function getAccessToken(tenantId, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://analysis.windows.net/powerbi/api/.default',
  }).toString();

  const res = await request({
    hostname: 'login.microsoftonline.com',
    path:     `/${tenantId}/oauth2/v2.0/token`,
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);

  if (!res.body.access_token) {
    throw new Error(res.body.error_description || res.body.error || 'Token acquisition failed');
  }
  return res.body.access_token;
}
