import { callAppsScript } from '@/lib/apps-script';
import { readSession } from '@/lib/kpi-auth';

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) return Response.json({ error: 'Потрібен вхід через Slack.' }, { status: 401 });
  try {
    const body = await request.json() as { ldap?: string; periodKey?: string; task?: string; status?: string };
    const ldap = String(body.ldap || '').trim().toUpperCase();
    const periodKey = String(body.periodKey || '').trim();
    const task = String(body.task || '').trim();
    const status = String(body.status || '').trim() || 'Заплановано';
    if (!/^CC[A-Z0-9._-]{3,60}$/.test(ldap) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(periodKey) || !task) return Response.json({ error: 'Вкажіть LDAP, місяць та крок донавчання.' }, { status: 400 });
    const data = await callAppsScript<{ ldap: string; periodKey: string; task: string; status: string }>('add_development_plan', { viewerLdap: session.ldap, targetLdap: ldap, periodKey, task, status });
    return Response.json(data, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: message === 'forbidden' ? 'Недостатньо прав.' : 'Не вдалося додати крок донавчання.' }, { status: message === 'forbidden' ? 403 : 503 });
  }
}
