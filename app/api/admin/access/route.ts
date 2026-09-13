import { callAppsScript } from '@/lib/apps-script';
import { readSession } from '@/lib/kpi-auth';

type AccessChange = { ldap: string; enabled: boolean };

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) return Response.json({ error: 'Потрібен вхід через Slack.' }, { status: 401 });

  let body: AccessChange;
  try {
    body = await request.json() as AccessChange;
  } catch {
    return Response.json({ error: 'Некоректний запит.' }, { status: 400 });
  }

  const ldap = String(body.ldap || '').trim().toUpperCase();
  if (!/^CC[A-Z0-9._-]{3,60}$/.test(ldap) || typeof body.enabled !== 'boolean') {
    return Response.json({ error: 'Некоректний LDAP або стан доступу.' }, { status: 400 });
  }

  try {
    const result = await callAppsScript<{ ldap: string; accessEnabled: boolean }>('set_access', {
      viewerLdap: session.ldap,
      targetLdap: ldap,
      enabled: body.enabled,
    });
    return Response.json(result, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не вдалося оновити доступ.';
    const status = message === 'forbidden' ? 403 : 503;
    return Response.json({ error: status === 403 ? 'Недостатньо прав для зміни доступу.' : 'Не вдалося оновити доступ. Спробуйте ще раз.' }, { status });
  }
}
