export type KpiRole = 'operator' | 'manager' | 'lead';

export type KpiSession = {
  ldap: string;
  role: KpiRole;
  expiresAt: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(value: Uint8Array) {
  let binary = '';
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function getSessionSecret() {
  const secret = process.env.KPI_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('KPI_SESSION_SECRET is not configured');
  return secret;
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(getSessionSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function createSession(ldap: string, role: KpiRole) {
  const payload: KpiSession = { ldap, role, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = toBase64Url(await sign(encoded));
  return `${encoded}.${signature}`;
}

export async function readSession(request: Request): Promise<KpiSession | null> {
  const rawCookie = request.headers.get('cookie') || '';
  const token = rawCookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('kpi_session='))?.slice('kpi_session='.length);
  if (!token) return null;

  const [encoded, providedSignature] = token.split('.');
  if (!encoded || !providedSignature) return null;

  const expectedSignature = await sign(encoded);
  const signature = fromBase64Url(providedSignature);
  if (signature.length !== expectedSignature.length) return null;
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) difference |= signature[index] ^ expectedSignature[index];
  if (difference !== 0) return null;

  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(encoded))) as KpiSession;
    if (!/^[a-z0-9._-]{3,64}$/i.test(payload.ldap) || !['operator', 'manager', 'lead'].includes(payload.role) || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string) {
  return `kpi_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`;
}
