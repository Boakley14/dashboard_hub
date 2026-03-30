/**
 * api/config/index.js
 * HTTP GET — returns public (non-secret) client configuration needed by the
 * frontend for MSAL.js authentication. Safe to call from any browser context.
 *
 * Returns:
 *   tenantId  — Azure AD / Entra ID tenant GUID
 *   clientId  — App registration client ID (public — not a secret)
 *   pbiScope  — Power BI API scope string (constant, but included for clarity)
 *
 * Required app settings:
 *   POWERBI_TENANT_ID   — Azure AD tenant ID
 *   POWERBI_CLIENT_ID   — App registration client ID (used for both service
 *                         principal flows and delegated user auth)
 *
 * Note: These values are NOT secrets. The client ID and tenant ID are safe
 * to expose to the browser — only POWERBI_CLIENT_SECRET is sensitive.
 */

module.exports = async function (context, req) {
  const tenantId = process.env.POWERBI_TENANT_ID;
  const clientId = process.env.POWERBI_CLIENT_ID;

  if (!tenantId || !clientId) {
    context.res = {
      status:  500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body:    { error: 'Auth configuration not set on server.' },
    };
    return;
  }

  context.res = {
    status:  200,
    headers: {
      'Content-Type':                 'application/json',
      'Access-Control-Allow-Origin':  '*',
      'Cache-Control':                'public, max-age=3600',  // config rarely changes
    },
    body: {
      tenantId,
      clientId,
      pbiScope:    'https://analysis.windows.net/powerbi/api/.default',
      redirectUri: null,  // frontend uses window.location.origin automatically
    },
  };
};
