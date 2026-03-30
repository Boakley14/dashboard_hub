/**
 * api/pbi-data/index.js
 * HTTP GET — executes named Power BI DAX queries against the Lodestar semantic
 * model and returns clean, frontend-ready JSON. No Power BI knowledge required
 * on the client side — just call the endpoint with a query name.
 *
 * Named queries:
 *   portfolio-kpis        — single-row portfolio summary (units, occupancy, revenue, NOI, leads)
 *   financial-trend       — monthly revenue, OpEx, NOI, margin  (?months=12)
 *   occupancy-by-property — per-property units, occupancy %, revenue, NOI
 *   move-activity-trend   — monthly move-in / move-out counts  (?months=12)
 *   leads-trend           — monthly leads, conversions, conversion rate  (?months=12)
 *   revenue-breakdown     — monthly rental / fee / insurance revenue split  (?months=12)
 *
 * Query params:
 *   query   (required) — one of the named query keys above
 *   months  (optional) — months back for trend queries; default 12, max 36
 *
 * Response envelope:
 *   { query, rows, columns, count, fetchedAt }
 *
 * Required app settings:
 *   POWERBI_TENANT_ID
 *   POWERBI_CLIENT_ID
 *   POWERBI_CLIENT_SECRET
 *
 * Defaults to the 10 Federal Lodestar semantic model.
 * Override with optional ?workspaceId=...&datasetId=... params.
 */

const https = require('https');

// ---- 10 Federal defaults ---------------------------------
const DEFAULT_WORKSPACE = 'df46ca8b-208f-4c39-ad9f-829f8379a5bd';
const DEFAULT_DATASET   = 'a28bcbcc-e7c9-4691-ad27-0f1cd7fdc19d';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type':                 'application/json',
};

// ---- Named query registry --------------------------------

/**
 * Build a DATE() filter for DAX that limits to the last `months` calendar months.
 * Because TODAY() is unavailable via the REST API, we compute the cutoff in JS.
 */
function dateCutoff(months) {
  const n = Math.max(1, Math.min(parseInt(months) || 12, 36));
  const start = new Date();
  start.setMonth(start.getMonth() - n + 1);
  start.setDate(1);
  return `DATE(${start.getFullYear()}, ${start.getMonth() + 1}, 1)`;
}

/**
 * Each query builder is a function that takes the parsed query params
 * and returns a DAX string starting with EVALUATE.
 */
const NAMED_QUERIES = {
  /**
   * portfolio-kpis
   * Single row — top-level portfolio KPIs across all time / all properties.
   * Ideal for hero stat cards on a dashboard landing page.
   */
  'portfolio-kpis': (_params) => `
EVALUATE ROW(
  "Total Units",       [Total Units],
  "Occupied Units",    [Occupied Units],
  "Vacant Units",      [Vacant Units],
  "Occupancy",         [Unit Occupancy],
  "Revenue",           [Revenue],
  "Operating Expenses",[Operating Expenses],
  "NOI",               [NOI],
  "NOI Margin",        [NOI Margin],
  "Total Leads",       [Total Leads],
  "Conversion Rate",   [Lead Conversion Rate]
)`,

  /**
   * financial-trend
   * Monthly P&L breakdown — Revenue, OpEx, NOI, margin, and revenue components.
   * Returns rows newest-first so the frontend can slice from index 0.
   */
  'financial-trend': (params) => `
EVALUATE
CALCULATETABLE(
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
  ),
  'Dates'[Full Date] >= ${dateCutoff(params.months)}
)
ORDER BY 'Dates'[Year] DESC, 'Dates'[Month] DESC`,

  /**
   * occupancy-by-property
   * One row per property — units, occupancy rate, revenue, and NOI.
   * Sorted by occupancy descending so best-performing properties come first.
   * Null/unnamed properties and properties with no revenue are excluded.
   */
  'occupancy-by-property': (_params) => `
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
)
ORDER BY [Occupancy] DESC`,

  /**
   * move-activity-trend
   * Monthly move-in and move-out counts.
   * Returns one row per activity type per month — pivot on "Move Activity" for charts.
   */
  'move-activity-trend': (params) => `
EVALUATE
CALCULATETABLE(
  SUMMARIZECOLUMNS(
    'Move Activity'[Move Activity],
    'Dates'[Year],
    'Dates'[Month],
    'Dates'[Month Name],
    "Count", COUNTROWS('Move Activity')
  ),
  'Dates'[Full Date] >= ${dateCutoff(params.months)}
)
ORDER BY 'Dates'[Year] DESC, 'Dates'[Month] DESC, 'Move Activity'[Move Activity]`,

  /**
   * leads-trend
   * Monthly lead pipeline — total leads, conversions, and conversion rate.
   */
  'leads-trend': (params) => `
EVALUATE
CALCULATETABLE(
  SUMMARIZECOLUMNS(
    'Dates'[Year],
    'Dates'[Month],
    'Dates'[Month Name],
    "Total Leads",    [Total Leads],
    "Conversions",    [Total Lead Conversion],
    "Conversion Rate",[Lead Conversion Rate]
  ),
  'Dates'[Full Date] >= ${dateCutoff(params.months)}
)
ORDER BY 'Dates'[Year] DESC, 'Dates'[Month] DESC`,

  /**
   * revenue-breakdown
   * Monthly split of revenue into Rental, Fee, and Insurance components.
   * Useful for stacked-bar or area charts showing revenue composition.
   */
  'revenue-breakdown': (params) => `
EVALUATE
CALCULATETABLE(
  SUMMARIZECOLUMNS(
    'Dates'[Year],
    'Dates'[Month],
    'Dates'[Month Name],
    "Total Revenue",    [Revenue],
    "Rental Revenue",   [Rental Revenue],
    "Fee Revenue",      [Fee Revenue],
    "Insurance Revenue",[Insurance Revenue]
  ),
  'Dates'[Full Date] >= ${dateCutoff(params.months)}
)
ORDER BY 'Dates'[Year] DESC, 'Dates'[Month] DESC`,
};

// ---- Main handler ----------------------------------------

module.exports = async function (context, req) {
  const params      = req.query ?? {};
  const queryName   = params.query;
  const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE;
  const datasetId   = params.datasetId   ?? DEFAULT_DATASET;

  // Validate query name
  if (!queryName) {
    context.res = {
      status:  400,
      headers: CORS,
      body:    {
        error:           'Missing required param: query',
        available_queries: Object.keys(NAMED_QUERIES),
      },
    };
    return;
  }

  const builder = NAMED_QUERIES[queryName];
  if (!builder) {
    context.res = {
      status:  400,
      headers: CORS,
      body:    {
        error:             `Unknown query: "${queryName}"`,
        available_queries: Object.keys(NAMED_QUERIES),
      },
    };
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
    // Build DAX from named query
    const dax = builder(params).trim();

    // Authenticate
    const token = await getAccessToken(tenantId, clientId, clientSecret);

    // Execute DAX
    const pbiRes = await pbiPost(token,
      `/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`,
      { queries: [{ query: dax }], serializerSettings: { includeNulls: true } }
    );

    if (pbiRes.status !== 200) {
      const msg = pbiRes.body?.error?.pbi?.error?.details?.[0]?.detail?.value
               ?? pbiRes.body?.error?.message
               ?? `Power BI returned HTTP ${pbiRes.status}`;
      context.res = { status: 502, headers: CORS, body: { error: msg } };
      return;
    }

    // Parse rows — strip table-name prefix from column keys
    const rawRows = pbiRes.body?.results?.[0]?.tables?.[0]?.rows ?? [];
    const rows    = rawRows.map(cleanRow);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    context.res = {
      status:  200,
      headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
      body:    {
        query:     queryName,
        rows,
        columns,
        count:     rows.length,
        fetchedAt: new Date().toISOString(),
      },
    };

  } catch (err) {
    context.log?.error('[pbi-data]', err.message);
    context.res = { status: 500, headers: CORS, body: { error: err.message } };
  }
};

// ---- Helpers -----------------------------------------------

/**
 * Strip the "TableName[ColumnName]" prefix from DAX result keys.
 * Examples:
 *   "Dates[Year]"               → "Year"
 *   "Properties[Property Name]" → "Property Name"
 *   "[Revenue]"                 → "Revenue"
 *   "Move Activity[Move Activity]" → "Move Activity"
 */
function cleanRow(row) {
  const clean = {};
  for (const [key, val] of Object.entries(row)) {
    const m = key.match(/\[([^\]]+)\]$/);
    clean[m ? m[1] : key] = val;
  }
  return clean;
}

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
    throw new Error(res.body.error_description ?? res.body.error ?? 'Token acquisition failed');
  }
  return res.body.access_token;
}

function pbiPost(token, path, body) {
  return request({
    hostname: 'api.powerbi.com',
    path,
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }, JSON.stringify(body));
}
