/**
 * api/pbi-schema/index.js
 * HTTP GET — returns table + column schema for a Power BI dataset.
 *
 * Query params:
 *   workspaceId  (required) — Power BI workspace / group GUID
 *   datasetId    (required) — Power BI dataset / semantic model GUID
 *
 * Required app settings:
 *   POWERBI_TENANT_ID     — Azure AD tenant ID
 *   POWERBI_CLIENT_ID     — Service principal app (client) ID
 *   POWERBI_CLIENT_SECRET — Service principal secret
 */

const https = require('https');

// ---- helpers -------------------------------------------------------

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': buf.length } },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function getAccessToken(tenantId, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://analysis.windows.net/powerbi/api/.default',
  }).toString();

  const res = await httpsPost(
    'login.microsoftonline.com',
    `/${tenantId}/oauth2/v2.0/token`,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  );

  if (!res.body.access_token) {
    throw new Error(res.body.error_description || res.body.error || 'Token acquisition failed');
  }
  return res.body.access_token;
}

// ---- main ----------------------------------------------------------

module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type':                 'application/json',
  };

  const { workspaceId, datasetId } = req.query || {};
  if (!workspaceId || !datasetId) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: 'Missing required query params: workspaceId, datasetId' },
    };
    return;
  }

  const tenantId     = process.env.POWERBI_TENANT_ID;
  const clientId     = process.env.POWERBI_CLIENT_ID;
  const clientSecret = process.env.POWERBI_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Power BI credentials not configured (POWERBI_TENANT_ID / CLIENT_ID / CLIENT_SECRET).' },
    };
    return;
  }

  try {
    const token = await getAccessToken(tenantId, clientId, clientSecret);

    const tablesRes = await httpsGet(
      'api.powerbi.com',
      `/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/tables`,
      { Authorization: `Bearer ${token}` }
    );

    if (tablesRes.status !== 200) {
      context.res = {
        status: tablesRes.status,
        headers: corsHeaders,
        body: { error: 'Power BI API error', detail: tablesRes.body },
      };
      return;
    }

    // Normalize: return tables with columns + measures, sorted alphabetically
    const tables = (tablesRes.body.value || [])
      .map(t => ({
        name:     t.name,
        columns:  (t.columns  || []).map(c => ({ name: c.name,  dataType: c.dataType  || '' })),
        measures: (t.measures || []).map(m => ({ name: m.name,  expression: m.expression || '' })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        datasetId,
        workspaceId,
        fetchedAt: new Date().toISOString(),
        tables,
      },
    };
  } catch (err) {
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: err.message },
    };
  }
};
