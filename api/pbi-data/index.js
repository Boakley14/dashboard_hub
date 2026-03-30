/**
 * api/pbi-data/index.js
 * HTTP GET — executes named DAX query shapes against the Lodestar semantic model,
 * with dynamic filter injection so any named query can be narrowed at runtime
 * without writing DAX or adding new named queries.
 *
 * ── Named query shapes ──────────────────────────────────────────────────────
 *   portfolio-kpis        — single-row KPIs (units, occupancy, revenue, NOI, leads)
 *   financial-trend       — monthly P&L (revenue, OpEx, NOI, margin, revenue components)
 *   occupancy-by-property — per-property snapshot (units, occupancy, revenue, NOI)
 *   move-activity-trend   — monthly move-in / move-out counts
 *   leads-trend           — monthly leads, conversions, conversion rate
 *   revenue-breakdown     — monthly rental / fee / insurance revenue split
 *   filter-options        — distinct values for filter dropdowns (properties, markets, states)
 *
 * ── Dynamic filter params (work on any query) ───────────────────────────────
 *   months    — last N months for trend queries (default 12, max 36)
 *   dateFrom  — start month  YYYY-MM  (overrides months)
 *   dateTo    — end month    YYYY-MM  (overrides months)
 *   property  — exact Property Name (may repeat: &property=A&property=B)
 *   market    — exact Market value
 *   state     — exact State value
 *
 * ── Response envelope ───────────────────────────────────────────────────────
 *   { query, filters, rows, columns, count, fetchedAt }
 *
 * ── Defaults ────────────────────────────────────────────────────────────────
 *   workspaceId — 10 Federal Semantic Models workspace
 *   datasetId   — Lodestar dataset
 *   Override with ?workspaceId=...&datasetId=...
 *
 * Required app settings:
 *   POWERBI_TENANT_ID / POWERBI_CLIENT_ID / POWERBI_CLIENT_SECRET
 */

const https = require('https');

const DEFAULT_WORKSPACE = 'df46ca8b-208f-4c39-ad9f-829f8379a5bd';
const DEFAULT_DATASET   = 'a28bcbcc-e7c9-4691-ad27-0f1cd7fdc19d';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type':                 'application/json',
};

// ============================================================
// Filter builder
// Converts URL query params into a DAX CALCULATETABLE wrapper.
// Returns { daxFilter, summary } where daxFilter is either an
// empty string (no filters) or a CALCULATETABLE(..., conditions)
// expression that wraps the inner query.
// ============================================================

function buildFilters(params) {
  const conditions = [];
  const summary    = {};

  // ── Date range ──────────────────────────────────────────
  if (params.dateFrom || params.dateTo) {
    // Explicit date range: YYYY-MM
    if (params.dateFrom) {
      const [y, m] = params.dateFrom.split('-').map(Number);
      if (y && m) {
        conditions.push(`'Dates'[Full Date] >= DATE(${y}, ${m}, 1)`);
        summary.dateFrom = params.dateFrom;
      }
    }
    if (params.dateTo) {
      const [y, m] = params.dateTo.split('-').map(Number);
      if (y && m) {
        // End of the chosen month
        conditions.push(`'Dates'[Full Date] <= DATE(${y}, ${m}, 28) + 4`);
        summary.dateTo = params.dateTo;
      }
    }
  } else if (params.months) {
    // Rolling window
    const n     = Math.max(1, Math.min(parseInt(params.months) || 12, 36));
    const start = new Date();
    start.setMonth(start.getMonth() - n + 1);
    start.setDate(1);
    conditions.push(
      `'Dates'[Full Date] >= DATE(${start.getFullYear()}, ${start.getMonth() + 1}, 1)`
    );
    summary.months = n;
  }

  // ── Property filter ─────────────────────────────────────
  // Supports multiple values: &property=A&property=B
  const properties = [params.property].flat().filter(Boolean);
  if (properties.length === 1) {
    conditions.push(`'Properties'[Property Name] = "${escDax(properties[0])}"`);
    summary.property = properties[0];
  } else if (properties.length > 1) {
    const list = properties.map(p => `"${escDax(p)}"`).join(', ');
    conditions.push(`'Properties'[Property Name] IN { ${list} }`);
    summary.property = properties;
  }

  // ── Market filter ────────────────────────────────────────
  const markets = [params.market].flat().filter(Boolean);
  if (markets.length === 1) {
    conditions.push(`'Properties'[Market] = "${escDax(markets[0])}"`);
    summary.market = markets[0];
  } else if (markets.length > 1) {
    const list = markets.map(m => `"${escDax(m)}"`).join(', ');
    conditions.push(`'Properties'[Market] IN { ${list} }`);
    summary.market = markets;
  }

  // ── State filter ─────────────────────────────────────────
  const states = [params.state].flat().filter(Boolean);
  if (states.length === 1) {
    conditions.push(`'Properties'[State] = "${escDax(states[0])}"`);
    summary.state = states[0];
  } else if (states.length > 1) {
    const list = states.map(s => `"${escDax(s)}"`).join(', ');
    conditions.push(`'Properties'[State] IN { ${list} }`);
    summary.state = states;
  }

  return { conditions, summary };
}

/** Escape double quotes inside a DAX string literal. */
function escDax(str) { return String(str).replace(/"/g, '""'); }

/**
 * Wrap an inner DAX query in a CALCULATETABLE filter.
 * If no conditions, returns the inner query unchanged.
 */
function applyFilters(innerDax, conditions) {
  if (!conditions.length) return innerDax;
  // CALCULATETABLE wraps the first EVALUATE expression
  return innerDax.replace(/^(\s*EVALUATE\s*)/i,
    `$1CALCULATETABLE(\n  (`
  ) + `\n),\n  ${conditions.join(',\n  ')}\n)`;
}

// ============================================================
// Named query shapes
// Each is a function of (params) → DAX string starting with EVALUATE.
// Filters are NOT baked in here — they are injected by applyFilters().
// Use params only for structural variation (e.g. choosing columns).
// ============================================================

const NAMED_QUERIES = {

  /** Single-row portfolio-wide KPIs. */
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

  /** Monthly P&L breakdown — Revenue, OpEx, NOI, margin + revenue components. */
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
)
ORDER BY 'Dates'[Year] DESC, 'Dates'[Month] DESC`.trim(),

  /** Per-property snapshot — units, occupancy, revenue, NOI. */
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
)
ORDER BY [Occupancy] DESC`.trim(),

  /** Monthly move-in / move-out counts. */
  'move-activity-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Move Activity'[Move Activity],
  'Dates'[Year],
  'Dates'[Month],
  'Dates'[Month Name],
  "Count", COUNTROWS('Move Activity')
)
ORDER BY 'Dates'[Year] DESC, 'Dates'[Month] DESC, 'Move Activity'[Move Activity]`.trim(),

  /** Monthly lead pipeline — leads, conversions, conversion rate. */
  'leads-trend': (_p) => `
EVALUATE
SUMMARIZECOLUMNS(
  'Dates'[Year],
  'Dates'[Month],
  'Dates'[Month Name],
  "Total Leads",    [Total Leads],
  "Conversions",    [Total Lead Conversion],
  "Conversion Rate",[Lead Conversion Rate]
)
ORDER BY 'Dates'[Year] DESC, 'Dates'[Month] DESC`.trim(),

  /** Monthly revenue split by component. */
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
)
ORDER BY 'Dates'[Year] DESC, 'Dates'[Month] DESC`.trim(),

  /**
   * filter-options
   * Returns distinct values for filter dropdowns.
   * Use this to populate <select> lists on a dashboard.
   * Ignores all filter params (intentionally returns full lists).
   * Returns: { properties[], markets[], states[] } in a single synthetic row
   * — actually returns three separate result sets concatenated as:
   *   [{ type: "property", value }, { type: "market", value }, { type: "state", value }]
   */
  'filter-options': (_p) => `
EVALUATE
UNION(
  SELECTCOLUMNS(
    FILTER(VALUES('Properties'[Property Name]), NOT ISBLANK('Properties'[Property Name])),
    "type", "property",
    "value", 'Properties'[Property Name]
  ),
  SELECTCOLUMNS(
    FILTER(VALUES('Properties'[Market]), NOT ISBLANK('Properties'[Market])),
    "type", "market",
    "value", 'Properties'[Market]
  )
)
ORDER BY [type], [value]`.trim(),

};

// ============================================================
// Main handler
// ============================================================

module.exports = async function (context, req) {
  const params      = req.query ?? {};
  const queryName   = params.query;
  const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE;
  const datasetId   = params.datasetId   ?? DEFAULT_DATASET;

  // Validate query name
  if (!queryName) {
    context.res = {
      status: 400, headers: CORS,
      body: { error: 'Missing required param: query', available: Object.keys(NAMED_QUERIES) },
    };
    return;
  }
  const builder = NAMED_QUERIES[queryName];
  if (!builder) {
    context.res = {
      status: 400, headers: CORS,
      body: { error: `Unknown query: "${queryName}"`, available: Object.keys(NAMED_QUERIES) },
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
    // Build base DAX + inject dynamic filters
    const baseDax              = builder(params);
    const { conditions, summary } = buildFilters(params);

    // filter-options intentionally skips all filters
    const dax = queryName === 'filter-options'
      ? baseDax
      : applyFilters(baseDax, conditions);

    // Authenticate + execute
    const token  = await getAccessToken(tenantId, clientId, clientSecret);
    const pbiRes = await pbiPost(token,
      `/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`,
      { queries: [{ query: dax }], serializerSettings: { includeNulls: true } }
    );

    if (pbiRes.status !== 200) {
      const msg = pbiRes.body?.error?.pbi?.error?.details?.[0]?.detail?.value
               ?? pbiRes.body?.error?.message
               ?? `Power BI returned HTTP ${pbiRes.status}`;
      context.res = { status: 502, headers: CORS, body: { error: msg, dax } };
      return;
    }

    // Parse + clean
    const rawRows = pbiRes.body?.results?.[0]?.tables?.[0]?.rows ?? [];
    const rows    = rawRows.map(cleanRow);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    context.res = {
      status:  200,
      headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
      body: {
        query:     queryName,
        filters:   summary,
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

// ============================================================
// Helpers
// ============================================================

/** Strip "TableName[Col]" prefix from DAX result keys → "Col" */
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
  if (!res.body.access_token) {
    throw new Error(res.body.error_description ?? res.body.error ?? 'Token acquisition failed');
  }
  return res.body.access_token;
}

function pbiPost(token, path, body) {
  return request({
    hostname: 'api.powerbi.com',
    path, method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, JSON.stringify(body));
}
