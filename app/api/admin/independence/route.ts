import { callAppsScript } from '@/lib/apps-script';
import { readSession } from '@/lib/kpi-auth';

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) return Response.json({ error: 'Потрібен вхід через Slack.' }, { status: 401 });
  try {
    const body = await request.json() as { ldap?: string; independence?: string };
    const ldap = String(body.ldap || '').trim().toUpperCase();
    if (!/^CC[A-Z0-9._-]{3,60}$/.test(ldap) || typeof body.independence !== 'string') return Response.json({ error: 'Некоректні дані.' }, { status: 400 });
    const data = await callAppsScript<{ ldap: string; independence: string }>('set_independence', { viewerLdap: session.ldap, targetLdap: ldap, independence: body.independence });
    return Response.json(data, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: message === 'forbidden' ? 'Недостатньо прав.' : 'Не вдалося зберегти рівень самостійності.' }, { status: message === 'forbidden' ? 403 : 503 });
  }
}
