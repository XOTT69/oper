import { callAppsScript } from '@/lib/apps-script';
import { createSession, sessionCookie, type KpiRole } from '@/lib/kpi-auth';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!/^[a-f0-9-]{36,80}$/i.test(token)) return new Response('Посилання для входу некоректне або вже використане.', { status: 400 });

  try {
    const user = await callAppsScript<{ ldap: string; role: KpiRole }>('consume_login', { magicToken: token });
    const session = await createSession(user.ldap, user.role);
    return new Response(null, { status: 302, headers: { location: new URL('/', request.url).toString(), 'set-cookie': sessionCookie(session) } });
  } catch {
    return new Response('Посилання для входу прострочене або вже використане.', { status: 400 });
  }
}
