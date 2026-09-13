import { callAppsScript } from '@/lib/apps-script';
import { readSession } from '@/lib/kpi-auth';

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) return Response.json({ error: 'Потрібен вхід через Slack.' }, { status: 401 });
  try {
    const body = await request.json() as { title?: string; url?: string; audience?: string };
    const title = String(body.title || '').trim();
    const url = String(body.url || '').trim();
    const audience = String(body.audience || 'ALL').trim().toUpperCase();
    if (!title || !/^https:\/\//i.test(url) || !(audience === 'ALL' || /^CC[A-Z0-9._-]{3,60}$/.test(audience))) return Response.json({ error: 'Вкажіть назву, HTTPS-посилання та LDAP або ALL.' }, { status: 400 });
    const data = await callAppsScript<{ title: string; url: string; audience: string; active: boolean }>('add_useful_link', { viewerLdap: session.ldap, title, url, audience });
    return Response.json(data, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: message === 'forbidden' ? 'Недостатньо прав.' : 'Не вдалося додати посилання.' }, { status: message === 'forbidden' ? 403 : 503 });
  }
}
