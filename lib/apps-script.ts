export class AppsScriptError extends Error {}

type AppsScriptResponse<T> = { ok: true; data: T } | { ok: false; error?: string };

export async function callAppsScript<T>(action: string, payload: Record<string, unknown>) {
  const url = process.env.KPI_APPS_SCRIPT_URL;
  const sharedSecret = process.env.KPI_APPS_SCRIPT_SECRET;
  if (!url || !sharedSecret) throw new AppsScriptError('KPI data connection is not configured');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, sharedSecret, ...payload }),
    redirect: 'follow',
  });

  let body: AppsScriptResponse<T>;
  try {
    body = await response.json() as AppsScriptResponse<T>;
  } catch {
    throw new AppsScriptError('KPI data service returned an invalid response');
  }
  if (!response.ok || !body.ok) throw new AppsScriptError(body.ok ? 'KPI data service is unavailable' : body.error || 'KPI data request failed');
  return body.data;
}
