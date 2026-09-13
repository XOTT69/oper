import { callAppsScript } from '@/lib/apps-script';
import { readSession } from '@/lib/kpi-auth';

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) return Response.json({ error: 'Потрібен вхід через Slack.' }, { status: 401 });
  try {
    const body = await request.json() as { direction?: string; metric?: string; target?: string };
    const direction = String(body.direction || '').trim() || 'ALL';
    const metric = String(body.metric || '').trim();
    const target = String(body.target || '').trim();
    if (!metric || !target) return Response.json({ error: 'Вкажіть показник та ціль.' }, { status: 400 });
    const data = await callAppsScript<{ direction: string; metric: string; target: string }>('set_kpi_target', { viewerLdap: session.ldap, direction, metric, target });
    return Response.json(data, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: message === 'forbidden' ? 'Недостатньо прав.' : 'Не вдалося зберегти ціль KPI.' }, { status: message === 'forbidden' ? 403 : 503 });
  }
}
