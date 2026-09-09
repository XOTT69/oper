import { callAppsScript } from '@/lib/apps-script';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { ldap?: string } | null;
  const ldap = body?.ldap?.trim().toUpperCase() || '';
  if (!/^CC[A-Z0-9._-]{3,60}$/.test(ldap)) return Response.json({ error: 'Вкажіть LDAP у форматі CC…' }, { status: 400 });
  if (!process.env.KPI_APPS_SCRIPT_URL || !process.env.KPI_APPS_SCRIPT_SECRET) {
    return Response.json({ error: 'Вхід ще налаштовується. Зверніться до керівника.' }, { status: 503 });
  }

  try {
    const loginBaseUrl = new URL('/api/auth/verify', request.url).toString();
    await callAppsScript('request_login', { ldap, loginBaseUrl });
  } catch {
    // Do not disclose whether an LDAP exists or has a connected Slack account.
  }
  return Response.json({ ok: true, message: 'Якщо доступ налаштовано, посилання вже надіслано в Slack.' }, { status: 202 });
}
