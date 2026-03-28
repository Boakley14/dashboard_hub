/**
 * api/health/index.js
 * HTTP GET — diagnostic endpoint to verify Azure app settings are configured.
 *
 * Visit /api/health in a browser to check:
 *   - AZURE_STORAGE_ACCOUNT_NAME is set
 *   - AZURE_STORAGE_SAS_TOKEN is set
 *
 * If either shows "NOT SET", go to:
 *   Azure Portal → Static Web App → Configuration → Application settings
 * and add the missing value.
 */

module.exports = async function (context) {
  const account  = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      ok:             !!(account && sasToken),
      storageAccount: account  ? `${account.slice(0, 4)}***`  : 'NOT SET',
      sasToken:       sasToken ? 'SET'                         : 'NOT SET',
      timestamp:      new Date().toISOString()
    }
  };
};
