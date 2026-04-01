/**
 * api/refresh/index.js
 * HTTP POST — Centralized query execution for Dashboard Hub (Feature 3).
 *
 * Accepts a dashboard ID (loads stored config) or an inline query list.
 * Executes every query against the Lodestar semantic model, returns a
 * structured results object, and persists refresh metadata to blob storage.
 *
 * ── Request body ──────────────────────────────────────────────────────
 *   dashboardId  (optional)  — load queries from /dashboards/{id}/config.json
 *   queries      (optional)  — [ { id, queryName, params, workspaceId?, datasetId? } ]
 *   filters      (optional)  — { dateFrom, dateTo, owner, property, market }
 *   If dashboardId is supplied and queries is omitted, config is loaded from blob.
 *
 * ── Response ──────────────────────────────────────────────────────────
 *   { results: { [queryId]: { rows, columns, count, error? } },
 *     refreshedAt, durationMs, queryCount }
 *
 * Required app settings:
 *   AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_SAS_TOKEN
 *   POWERBI_TENANT_ID, POWERBI_CLIENT_ID, POWERBI_CLIENT_SECRET
 */

const https = require('https');

const CONTAINER        = 'dashboards';
const DEFAULT_WORKSPACE = 'df46ca8b-208f-4c39-ad9f-829f8379a5bd';
const DEFAULT_DATASET   = 'a28bcbcc-e7c9-4691-ad27-0f1cd7fdc19d';
const PREVIEW_LIMIT     = 50;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                 'application/json',
};

// ── Named DAX query shapes (mirrors api/pbi-data NAMED_QUERIES) ───────
const NAMED_QUERIES = {

  'metric-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Dates'[Year],
  'Dates'[Month],
  'Dates'[Month Name],
  "Unit Occupancy",        [Unit Occupancy],
  "Total Units",           [Total Units],
  "Occupied Units",        [Occupied Units],
  "Vacant Units",          [Vacant Units],
  "Revenue",               [Revenue],
  "Rental Revenue",        [Rental Revenue],
  "Operating Expenses",    [Operating Expenses],
  "NOI",                   [NOI],
  "Total Leads",           [Total Leads],
  "Total Lead Conversion", [Total Lead Conversion],
  "Total Move Ins",        [Total Move Ins],
  "Total Move Outs",       [Total Move Outs],
  "Net Move Ins",          [Net Move Ins],
  "Loss to Lease",         [Loss to Lease]
)`.trim(),

  'portfolio-kpis': (_p) => `
EVALUATE ROW(
  "Total Units",        [Total Units],
  "Occupied Units",     [Occupied Units],
  "Vacant Units",       [Vacant Units],
  "Occupancy",          [Unit Occupancy],
  "Revenue",            [Revenue],
  "Operating Expenses", [Operating Expenses],
  "NOI",                [NOI],
  "NOI Margin",         [NOI Margin],
  "Total Leads",        [Total Leads],
  "Conversion Rate",    [Lead Conversion Rate]
)`.trim(),

  'financial-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Dates'[Year],
  'Dates'[Month],
  'Dates'[Month Name],
  "Revenue",             [Revenue],
  "Operating Expenses",  [Operating Expenses],
  "NOI",                 [NOI],
  "NOI Margin",          [NOI Margin],
  "Rental Revenue",      [Rental Revenue],
  "Fee Revenue",         [Fee Revenue],
  "Insurance Revenue",   [Insurance Revenue]
)`.trim(),

  'occupancy-by-property': (_p) => `
EVALUATE
FILTER(
  SUMMARIZECOLUMNS(
    'Properties'[Property Name],
    "Total Units",    [Total Units],
    "Occupied Units", [Occupied Units],
    "Occupancy",      [Unit Occupancy],
    "Revenue",        [Revenue],
    "NOI",            [NOI]
  ),
  NOT ISBLANK('Properties'[Property Name]) && [Revenue] > 0
)`.trim(),

  'move-activity-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Move Activity'[Move Activity],
  'Dates'[Year],
  'Dates'[Month],
  'Dates'[Month Name],
  "Count", COUNTROWS('Move Activity')
)`.trim(),

  'leads-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Dates'[Year],
  'Dates'[Month],
  'Dates'[Month Name],
  "Total Leads",    [Total Leads],
  "Conversions",    [Total Lead Conversion],
  "Conversion Rate",[Lead Conversion Rate]
)`.trim(),

  'revenue-breakdown': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Dates'[Year],
  'Dates'[Month],
  'Dates'[Month Name],
  "Total Revenue",     [Revenue],
  "Rental Revenue",    [Rental Revenue],
  "Fee Revenue",       [Fee Revenue],
  "Insurance Revenue", [Insurance Revenue]
)`.trim(),

  'filter-options': (_p) => `
EVALUATE
UNION(
  SELECTCOLUMNS(
    FILTER(VALUES('Properties'[Owner]), NOT ISBLANK('Properties'[Owner])),
    "type",  "owner",
    "value", 'Properties'[Owner],
    "group", ""
  ),
  SELECTCOLUMNS(
    FILTER(
      SUMMARIZECOLUMNS('Properties'[Owner], 'Properties'[Property Name]),
      NOT ISBLANK('Properties'[Property Name])
    ),
    "type",  "property",
    "value", 'Properties'[Property Name],
    "group", 'Properties'[Owner]
  ),
  SELECTCOLUMNS(
    FILTER(VALUES('Properties'[Market]), NOT ISBLANK('Properties'[Market])),
    "type",  "market",
    "value", 'Properties'[Market],
    "group", ""
  )
)
ORDER BY [type], [group], [value]`.trim(),
};

// ── Main handler ──────────────────────────────────────────────────────
module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 200, headers: CORS, body: '' };
    return;
  }
  if (req.method !== 'POST') {
    context.res = { status: 405, headers: CORS, body: { error: 'POST only' } };
    return;
  }

  const body        = req.body || {};
  const dashboardId = body.dashboardId;
  const filters     = body.filters || {};
  let   queries     = body.queries;

  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
  const tenantId     = process.env.POWERBI_TENANT_ID;
  const clientId     = process.env.POWERBI_CLIENT_ID;
  const clientSecret = process.env.POWERBI_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    context.res = { status: 500, headers: CORS, body: { error: 'Power BI credentials not configured.' } };
    return;
  }

  // Load stored config when dashboardId provided but no inline queries
  if (dashboardId && account && sasToken && (!queries || !queries.length)) {
    const host      = `${account}.blob.core.windows.net`;
    const configRes = await blobGet(host, `/${CONTAINER}/${dashboardId}/config.json?${sasToken}`);
    if (configRes.statusCode === 200) {
      try {
        const cfg = JSON.parse(configRes.body);
        queries = cfg.queries || [];
      } catch { /* use inline queries */ }
    }
  }

  if (!queries || !queries.length) {
    context.res = {
      status: 400, headers: CORS,
      body: { error: 'No queries found. Provide queries[] in body or a dashboardId with stored config.' },
    };
    return;
  }

  const startTime = Date.now();

  try {
    const token      = await getAccessToken(tenantId, clientId, clientSecret);
    const conditions = buildConditions(filters);
    const results    = {};

    for (const q of queries) {
      const builder = NAMED_QUERIES[q.queryName];
      if (!builder) {
        results[q.id] = { error: `Unknown queryName: "${q.queryName}"`, rows: [], columns: [], count: 0 };
        continue;
      }

      const baseDax = builder(q.params || {});
      const dax     = q.queryName === 'filter-options'
        ? baseDax
        : applyFilters(baseDax, conditions);

      const wsId  = q.workspaceId || DEFAULT_WORKSPACE;
      const dsId  = q.datasetId   || DEFAULT_DATASET;

      try {
        const pbiRes = await pbiPost(token,
          `/v1.0/myorg/groups/${wsId}/datasets/${dsId}/executeQueries`,
          { queries: [{ query: dax }], serializerSettings: { includeNulls: true } }
        );

        if (pbiRes.status === 200) {
          const rawRows = pbiRes.body?.results?.[0]?.tables?.[0]?.rows ?? [];
          const rows    = rawRows.map(cleanRow);
          results[q.id] = { rows, columns: rows.length ? Object.keys(rows[0]) : [], count: rows.length };
        } else {
          const msg = pbiRes.body?.error?.pbi?.error?.details?.[0]?.detail?.value
                   ?? pbiRes.body?.error?.message
                   ?? `Power BI HTTP ${pbiRes.status}`;
          results[q.id] = { error: msg, rows: [], columns: [], count: 0 };
        }
      } catch (qErr) {
        results[q.id] = { error: qErr.message, rows: [], columns: [], count: 0 };
      }
    }

    const durationMs  = Date.now() - startTime;
    const refreshedAt = new Date().toISOString();
    const hasError    = Object.values(results).some(r => r.error);

    // Persist refresh metadata
    if (dashboardId && account && sasToken) {
      const meta = {
        lastRefreshUtc:       refreshedAt,
        lastRefreshStatus:    hasError ? 'partial' : 'success',
        lastRefreshDurationMs: durationMs,
      };
      const host = `${account}.blob.core.windows.net`;
      await blobPut(
        host,
        `/${CONTAINER}/${dashboardId}/metadata.json?${sasToken}`,
        Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'),
        'application/json'
      ).catch(() => { /* non-fatal */ });
    }

    context.res = {
      status: 200, headers: CORS,
      body: { results, refreshedAt, durationMs, queryCount: queries.length },
    };

  } catch (err) {
    const durationMs = Date.now() - startTime;
    if (dashboardId && account && sasToken) {
      const host = `${account}.blob.core.windows.net`;
      const meta = {
        lastRefreshUtc:       new Date().toISOString(),
        lastRefreshStatus:    'error',
        lastRefreshDurationMs: durationMs,
        lastRefreshError:     err.message,
      };
      await blobPut(
        host,
        `/${CONTAINER}/${dashboardId}/metadata.json?${sasToken}`,
        Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'),
        'application/json'
      ).catch(() => {});
    }
    context.log?.error('[refresh]', err.message);
    context.res = { status: 502, headers: CORS, body: { error: err.message } };
  }
};

// ── Filter builder (mirrors api/pbi-data buildFilters) ────────────────
function buildConditions(filters) {
  const conds = [];
  if (filters.dateFrom) {
    const [y, m] = filters.dateFrom.split('-').map(Number);
    if (y && m) conds.push(`'Dates'[Full Date] >= DATE(${y}, ${m}, 1)`);
  }
  if (filters.dateTo) {
    const [y, m] = filters.dateTo.split('-').map(Number);
    if (y && m) conds.push(`'Dates'[Full Date] <= DATE(${y}, ${m}, 28) + 4`);
  }
  const owners = [filters.owner].flat().filter(Boolean);
  if (owners.length === 1) conds.push(`'Properties'[Owner] = "${escDax(owners[0])}"`);
  else if (owners.length > 1) conds.push(`'Properties'[Owner] IN { ${owners.map(o => `"${escDax(o)}"`).join(', ')} }`);
  const props = [filters.property].flat().filter(Boolean);
  if (props.length === 1) conds.push(`'Properties'[Property Name] = "${escDax(props[0])}"`);
  else if (props.length > 1) conds.push(`'Properties'[Property Name] IN { ${props.map(p => `"${escDax(p)}"`).join(', ')} }`);
  const markets = [filters.market].flat().filter(Boolean);
  if (markets.length === 1) conds.push(`'Properties'[Market] = "${escDax(markets[0])}"`);
  return conds;
}

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

// ── HTTP helpers ──────────────────────────────────────────────────────
function request(opts, bodyStr) {
  return new Promise((resolve, reject) => {
    const buf     = bodyStr ? Buffer.from(bodyStr, 'utf-8') : null;
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
