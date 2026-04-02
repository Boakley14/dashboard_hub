/**
 * api/preview/index.js
 * HTTP GET — executes a named DAX query and returns the first N rows as a
 * read-only data preview (Feature 5).
 *
 * ── Query params ──────────────────────────────────────────────────────
 *   queryName   (required) — named query to execute
 *   dashboardId (optional) — used to resolve workspaceId/datasetId from stored config
 *   workspaceId (optional) — override default workspace
 *   datasetId   (optional) — override default dataset
 *   limit       (optional) — max rows to return (default 50, max 50)
 *   dateFrom, dateTo, owner, property, market — filter params
 *
 * ── Response ──────────────────────────────────────────────────────────
 *   { rows, columns, count, limited, queryName, fetchedAt }
 *
 * ── Timeout ───────────────────────────────────────────────────────────
 *   Power BI call aborted after 8 s; response still returns partial info.
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_SAS_TOKEN
 *   POWERBI_TENANT_ID, POWERBI_CLIENT_ID, POWERBI_CLIENT_SECRET
 */

const https = require('https');

const CONTAINER        = 'dashboards';
const DEFAULT_WORKSPACE = 'df46ca8b-208f-4c39-ad9f-829f8379a5bd';
const DEFAULT_DATASET   = 'a28bcbcc-e7c9-4691-ad27-0f1cd7fdc19d';
const MAX_PREVIEW_ROWS  = 50;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type':                 'application/json',
};

// Minimal set of named queries for preview (same shapes as pbi-data)
const NAMED_QUERIES = {
  'metric-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Dates'[Year], 'Dates'[Month], 'Dates'[Month Name],
  "Unit Occupancy", [Unit Occupancy],
  "Total Units",    [Total Units],
  "Revenue",        [Revenue],
  "NOI",            [NOI],
  "Total Leads",    [Total Leads]
)`.trim(),
  'portfolio-kpis': (_p) => `
EVALUATE ROW(
  "Total Units",  [Total Units],
  "Occupancy",    [Unit Occupancy],
  "Revenue",      [Revenue],
  "NOI",          [NOI],
  "Total Leads",  [Total Leads]
)`.trim(),
  'financial-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Dates'[Year], 'Dates'[Month], 'Dates'[Month Name],
  "Revenue", [Revenue], "Operating Expenses", [Operating Expenses],
  "NOI", [NOI], "NOI Margin", [NOI Margin]
)`.trim(),
  'occupancy-by-property': (_p) => `
EVALUATE
FILTER(
  SUMMARIZECOLUMNS(
    'Properties'[Property Name],
    "Total Units", [Total Units], "Occupancy", [Unit Occupancy],
    "Revenue", [Revenue], "NOI", [NOI]
  ),
  NOT ISBLANK('Properties'[Property Name]) && [Revenue] > 0
)`.trim(),
  'leads-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Dates'[Year], 'Dates'[Month], 'Dates'[Month Name],
  "Total Leads", [Total Leads], "Conversions", [Total Lead Conversion]
)`.trim(),
  'revenue-breakdown': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Dates'[Year], 'Dates'[Month], 'Dates'[Month Name],
  "Total Revenue", [Revenue], "Rental Revenue", [Rental Revenue],
  "Fee Revenue", [Fee Revenue], "Insurance Revenue", [Insurance Revenue]
)`.trim(),
  'move-activity-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Move Activity'[Move Activity], 'Dates'[Year], 'Dates'[Month], 'Dates'[Month Name],
  "Count", COUNTROWS('Move Activity')
)`.trim(),
  'filter-options': (_p) => `
EVALUATE
UNION(
  SELECTCOLUMNS(FILTER(VALUES('Properties'[Owner]), NOT ISBLANK('Properties'[Owner])),
    "type", "owner", "value", 'Properties'[Owner], "group", ""),
  SELECTCOLUMNS(
    FILTER(SUMMARIZECOLUMNS('Properties'[Owner], 'Properties'[Property Name]),
      NOT ISBLANK('Properties'[Property Name])),
    "type", "property", "value", 'Properties'[Property Name], "group", 'Properties'[Owner])
)
ORDER BY [type], [value]`.trim(),
};

module.exports = async function (context, req) {
  const params      = req.query ?? {};
  const queryName   = params.queryName;
  const queryId     = params.queryId;    // new-schema mode
  const dashboardId = params.dashboardId;
  const limit       = Math.min(parseInt(params.limit) || MAX_PREVIEW_ROWS, MAX_PREVIEW_ROWS);

  if (!queryName && !queryId) {
    context.res = { status: 400, headers: CORS, body: { error: 'Missing required param: queryName or queryId' } };
    return;
  }

  const tenantId     = process.env.POWERBI_TENANT_ID;
  const clientId     = process.env.POWERBI_CLIENT_ID;
  const clientSecret = process.env.POWERBI_CLIENT_SECRET;
  const account      = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken     = process.env.AZURE_STORAGE_SAS_TOKEN;

  if (!tenantId || !clientId || !clientSecret) {
    context.res = { status: 500, headers: CORS, body: { error: 'Power BI credentials not configured.' } };
    return;
  }

  // ── New-schema mode: queryId + dashboardId → load config, find query, execute inline DAX ──
  if (queryId && dashboardId && account && sasToken) {
    const host   = `${account}.blob.core.windows.net`;
    const cfgRes = await blobGetWithFallback(host,
      `/${CONTAINER}/${dashboardId}/dashboard.config.json?${sasToken}`,
      `/${CONTAINER}/${dashboardId}/config.json?${sasToken}`);

    if (cfgRes.statusCode !== 200) {
      context.res = { status: 404, headers: CORS, body: { error: 'Dashboard config not found.' } };
      return;
    }

    let cfg;
    try { cfg = JSON.parse(cfgRes.body); } catch {
      context.res = { status: 500, headers: CORS, body: { error: 'Dashboard config is malformed.' } };
      return;
    }

    const query = (cfg.queries || []).find(q => q.queryId === queryId);
    if (!query) {
      context.res = { status: 404, headers: CORS, body: { error: `Query "${queryId}" not found in dashboard config.` } };
      return;
    }
    if (!query.text) {
      context.res = { status: 400, headers: CORS, body: { error: `Query "${queryId}" has no inline DAX text.` } };
      return;
    }

    const previewLimit   = Math.min(cfg.preview?.maxRows  ?? MAX_PREVIEW_ROWS, MAX_PREVIEW_ROWS);
    const timeoutMs      = (cfg.preview?.timeoutSeconds ?? 5) * 1000;
    const workspaceId    = cfg.dataSource?.workspaceId || DEFAULT_WORKSPACE;
    const datasetId      = cfg.dataSource?.datasetId   || DEFAULT_DATASET;

    try {
      const token  = await getAccessToken(tenantId, clientId, clientSecret);
      const pbiRes = await pbiPost(token,
        `/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`,
        { queries: [{ query: query.text }], serializerSettings: { includeNulls: true } },
        timeoutMs
      );

      if (pbiRes.status !== 200) {
        const msg = pbiRes.body?.error?.pbi?.error?.details?.[0]?.detail?.value
                 ?? pbiRes.body?.error?.message
                 ?? `Power BI HTTP ${pbiRes.status}`;
        context.res = { status: 200, headers: CORS, body: { error: 'Preview failed', detail: msg } };
        return;
      }

      const table   = pbiRes.body?.results?.[0]?.tables?.[0];
      const columns = (table?.columns ?? []).map(c => {
        const m = c.name.match(/\[([^\]]+)\]$/);
        return m ? m[1] : c.name;
      });
      const allRows = (table?.rows ?? []).map(r => columns.map(c => {
        const rawKey = Object.keys(r).find(k => { const m = k.match(/\[([^\]]+)\]$/); return (m ? m[1] : k) === c; });
        return rawKey !== undefined ? r[rawKey] : null;
      }));
      const rows    = allRows.slice(0, previewLimit);

      context.res = {
        status: 200, headers: CORS,
        body: { columns, rows, count: rows.length, totalRows: allRows.length,
                limited: allRows.length > previewLimit, queryId, fetchedAt: new Date().toISOString() },
      };
    } catch (err) {
      context.log?.error('[preview/new]', err.message);
      context.res = { status: 200, headers: CORS, body: { error: 'Preview failed', detail: err.message } };
    }
    return;
  }

  // ── Legacy mode: queryName → NAMED_QUERIES dict ───────────────────────
  if (!queryName) {
    context.res = { status: 400, headers: CORS, body: { error: 'Missing required param: queryName (or provide queryId + dashboardId for new-schema dashboards)' } };
    return;
  }
  const builder = NAMED_QUERIES[queryName];
  if (!builder) {
    context.res = {
      status: 400, headers: CORS,
      body: { error: `Unknown queryName: "${queryName}"`, available: Object.keys(NAMED_QUERIES) },
    };
    return;
  }

  // Resolve workspace/dataset — try stored config, then params, then defaults
  let workspaceId = params.workspaceId || DEFAULT_WORKSPACE;
  let datasetId   = params.datasetId   || DEFAULT_DATASET;

  if (dashboardId && account && sasToken) {
    const host   = `${account}.blob.core.windows.net`;
    const cfgRes = await blobGetWithFallback(host,
      `/${CONTAINER}/${dashboardId}/dashboard.config.json?${sasToken}`,
      `/${CONTAINER}/${dashboardId}/config.json?${sasToken}`);
    if (cfgRes.statusCode === 200) {
      try {
        const cfg   = JSON.parse(cfgRes.body);
        workspaceId = cfg.dataSource?.workspaceId || cfg.workspaceId || workspaceId;
        datasetId   = cfg.dataSource?.datasetId   || cfg.datasetId   || datasetId;
      } catch { /* use defaults */ }
    }
  }

  try {
    const token = await getAccessToken(tenantId, clientId, clientSecret);

    // Build minimal filters for preview
    const conditions = [];
    if (params.dateFrom) {
      const [y, m] = params.dateFrom.split('-').map(Number);
      if (y && m) conditions.push(`'Dates'[Full Date] >= DATE(${y}, ${m}, 1)`);
    }
    if (params.dateTo) {
      const [y, m] = params.dateTo.split('-').map(Number);
      if (y && m) conditions.push(`'Dates'[Full Date] <= DATE(${y}, ${m}, 28) + 4`);
    }
    if (params.owner)  conditions.push(`'Properties'[Owner] = "${escDax(params.owner)}"`);

    const baseDax = builder({});
    const dax = queryName === 'filter-options' ? baseDax : applyFilters(baseDax, conditions);

    const pbiRes = await pbiPost(token,
      `/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`,
      { queries: [{ query: dax }], serializerSettings: { includeNulls: true } }
    );

    if (pbiRes.status !== 200) {
      const msg = pbiRes.body?.error?.pbi?.error?.details?.[0]?.detail?.value
               ?? pbiRes.body?.error?.message
               ?? `Power BI HTTP ${pbiRes.status}`;
      context.res = { status: 502, headers: CORS, body: { error: msg } };
      return;
    }

    const rawRows = pbiRes.body?.results?.[0]?.tables?.[0]?.rows ?? [];
    const allRows = rawRows.map(cleanRow);
    const rows    = allRows.slice(0, limit);
    const columns = rows.length ? Object.keys(rows[0]) : [];

    context.res = {
      status: 200, headers: CORS,
      body: {
        rows, columns,
        count:     rows.length,
        totalRows: allRows.length,
        limited:   allRows.length > limit,
        queryName, fetchedAt: new Date().toISOString(),
      },
    };

  } catch (err) {
    context.log?.error('[preview]', err.message);
    context.res = { status: 500, headers: CORS, body: { error: err.message } };
  }
};

// ── Helpers ───────────────────────────────────────────────────────────
function escDax(str) { return String(str).replace(/"/g, '""'); }

function applyFilters(innerDax, conditions) {
  if (!conditions.length) return innerDax;
  return innerDax.replace(/^(\s*EVALUATE\s*)/i, `$1CALCULATETABLE(\n  (`) + `\n),\n  ${conditions.join(',\n  ')}\n)`;
}

function cleanRow(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    const m = key.match(/\[([^\]]+)\]$/);
    out[m ? m[1] : key] = val;
  }
  return out;
}

function request(opts, bodyStr) {
  return new Promise((resolve, reject) => {
    const buf = bodyStr ? Buffer.from(bodyStr, 'utf-8') : null;
    const headers = { ...opts.headers };
    if (buf) headers['Content-Length'] = buf.length;
    const req = https.request({ ...opts, headers }, res => {
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

async function getAccessToken(tenantId, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials', client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://analysis.windows.net/powerbi/api/.default',
  }).toString();
  const res = await request({
    hostname: 'login.microsoftonline.com',
    path:     `/${tenantId}/oauth2/v2.0/token`,
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);
  if (!res.body.access_token) throw new Error(res.body.error_description ?? 'Token acquisition failed');
  return res.body.access_token;
}

function pbiPost(token, path, body) {
  return request({
    hostname: 'api.powerbi.com',
    path, method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, JSON.stringify(body));
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

// Try primaryPath first; if 404, try fallbackPath.
async function blobGetWithFallback(host, primaryPath, fallbackPath) {
  const primary = await blobGet(host, primaryPath);
  if (primary.statusCode === 404 && fallbackPath) {
    return blobGet(host, fallbackPath);
  }
  return primary;
}
