/**
 * api/pbi-schema/index.js
 * HTTP GET — returns table + column + measure schema for a Power BI semantic model.
 *
 * Uses DAX INFO() functions via the executeQueries endpoint for accurate schema
 * on imported/ABF datasets. Falls back to the REST /tables endpoint if DAX fails.
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

// ---- Data type map (Analysis Services ExtendedType enum) ------
const DATA_TYPES = {
  2: 'Text', 6: 'Whole Number', 8: 'Decimal',
  9: 'Date/Time', 10: 'Currency', 11: 'Boolean', 17: 'Binary', 19: 'Variant',
};

// ---- HTTP helpers ----------------------------------------------

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const buf = body ? Buffer.from(body) : null;
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

// ---- Token acquisition -----------------------------------------

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

// ---- Schema via DAX INFO() functions (primary method) ----------
// Works for imported / ABF semantic models. Sends three INFO queries
// in one executeQueries call to get tables, columns, and measures.

async function getSchemaViaDax(token, workspaceId, datasetId) {
  const payload = JSON.stringify({
    queries: [
      // Hidden = false filter keeps internal/system tables out
      { query: `EVALUATE SELECTCOLUMNS(FILTER(INFO.TABLES(), [IsHidden] = FALSE()), "tid", [ID], "name", [Name])` },
      // ColumnType 3 = RowNumber (internal) — exclude it
      { query: `EVALUATE SELECTCOLUMNS(FILTER(INFO.COLUMNS(), [IsHidden] = FALSE() && [ColumnType] <> 3), "tid", [TableID], "name", [ExplicitName], "dt", [DataType])` },
      { query: `EVALUATE SELECTCOLUMNS(FILTER(INFO.MEASURES(), [IsHidden] = FALSE()), "tid", [TableID], "name", [Name])` },
    ],
    serializerSettings: { includeNulls: true },
  });

  const res = await request({
    hostname: 'api.powerbi.com',
    path:     `/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`,
    method:   'POST',
    headers:  { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, payload);

  if (res.status !== 200 || res.body.error) return null;

  const results = res.body.results ?? [];
  const tRows   = results[0]?.tables?.[0]?.rows ?? [];
  const cRows   = results[1]?.tables?.[0]?.rows ?? [];
  const mRows   = results[2]?.tables?.[0]?.rows ?? [];

  // Build table map indexed by internal ID
  const byId = {};
  tRows.forEach(r => {
    byId[r['[tid]']] = { name: r['[name]'], columns: [], measures: [] };
  });

  cRows.forEach(r => {
    const t = byId[r['[tid]']];
    if (t) t.columns.push({
      name:     r['[name]'],
      dataType: DATA_TYPES[r['[dt]']] ?? `Type ${r['[dt]']}`,
    });
  });

  mRows.forEach(r => {
    const t = byId[r['[tid]']];
    if (t) t.measures.push({ name: r['[name]'] });
  });

  const tables = Object.values(byId)
    .filter(t => t.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return tables.length ? tables : null;
}

// ---- Schema via REST /tables endpoint (fallback) ---------------
// Works for push datasets; may return empty for imported datasets.

async function getSchemaViaRest(token, workspaceId, datasetId) {
  const res = await request({
    hostname: 'api.powerbi.com',
    path:     `/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/tables`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  });

  if (res.status !== 200) return null;

  const tables = (res.body.value ?? []).map(t => ({
    name:     t.name,
    columns:  (t.columns  ?? []).map(c => ({ name: c.name, dataType: c.dataType ?? '' })),
    measures: (t.measures ?? []).map(m => ({ name: m.name })),
  })).sort((a, b) => a.name.localeCompare(b.name));

  return tables.length ? tables : null;
}

// ---- Main handler ----------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type':                 'application/json',
};

module.exports = async function (context, req) {
  const { workspaceId, datasetId } = req.query ?? {};

  if (!workspaceId || !datasetId) {
    context.res = { status: 400, headers: CORS, body: { error: 'Missing query params: workspaceId, datasetId' } };
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
    const token = await getAccessToken(tenantId, clientId, clientSecret);

    // Try DAX INFO() approach first (works for imported/ABF models)
    let tables = await getSchemaViaDax(token, workspaceId, datasetId);

    // Fall back to REST /tables if DAX returned nothing
    if (!tables) {
      context.res.log?.('[pbi-schema] DAX returned no tables, falling back to REST /tables');
      tables = await getSchemaViaRest(token, workspaceId, datasetId) ?? [];
    }

    context.res = {
      status: 200,
      headers: CORS,
      body: { datasetId, workspaceId, fetchedAt: new Date().toISOString(), tables },
    };
  } catch (err) {
    context.res = { status: 500, headers: CORS, body: { error: err.message } };
  }
};
