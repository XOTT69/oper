import { callAppsScript } from '@/lib/apps-script';
import { readSession } from '@/lib/kpi-auth';

export async function GET(request: Request) {
  const session = await readSession(request);
  if (!session) return Response.json({ error: 'Потрібен вхід через Slack.' }, { status: 401 });

  try {
    const dashboard = await callAppsScript('get_dashboard', { ldap: session.ldap });
    return Response.json(dashboard, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'Не вдалося отримати KPI. Спробуйте ще раз.' }, { status: 503 });
  }
}
