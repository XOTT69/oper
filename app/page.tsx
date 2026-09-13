'use client';

import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  House,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HelpfulLinks, OperatorPreview, type HelpfulLink } from '@/components/operator-preview';

type Recommendation = { title: string; text: string };
type ErrorTheme = { name: string; count: number };
type DashboardRow = {
  ldap: string;
  operator: string;
  periodLabel: string;
  scoreNumber: number | null;
  quality: string;
  at?: string;
  sl?: string;
  slAsa?: string;
  knowledge?: string;
  kkdPercent: string;
  requests: string;
  periodKey: string;
  recommendations?: Recommendation[];
  errorAdvice?: string[];
  errorThemes?: ErrorTheme[];
  critsCount?: number;
  warningsCount?: number;
  errorsTotal?: number;
  errorExamples?: { type: string; category: string; date: string; text: string }[];
};
type AccessProfile = { ldap: string; operator: string; direction?: string; team?: string; role?: string; level?: string; status?: string; independence?: string; hasKpi?: boolean; accessEnabled?: boolean };
type Dashboard = {
  viewer: { ldap: string; operator: string; role: string; direction?: string; team?: string };
  rows: DashboardRow[];
  latestPeriodKey?: string;
  accessProfiles?: AccessProfile[];
  helpfulLinks?: HelpfulLink[];
  adminLinks?: HelpfulLink[];
};

function NavItem({ icon: Icon, label, active = false, onClick }: { icon: typeof House; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
        active ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      <Icon className="size-[18px]" strokeWidth={active ? 2.4 : 2} />
      {label}
    </button>
  );
}

export default function Home() {
  const [ldap, setLdap] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [loginPending, setLoginPending] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [accessPending, setAccessPending] = useState<string | null>(null);
  const [accessMessage, setAccessMessage] = useState('');
  const [previewLdap, setPreviewLdap] = useState('');
  const [independenceDrafts, setIndependenceDrafts] = useState<Record<string, string>>({});
  const [independencePending, setIndependencePending] = useState<string | null>(null);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkAudience, setLinkAudience] = useState('ALL');
  const [linkPending, setLinkPending] = useState(false);
  const [ownPeriod, setOwnPeriod] = useState('');
  const [previewPeriod, setPreviewPeriod] = useState('');
  const [adminPeriod, setAdminPeriod] = useState('');
  const [adminDirection, setAdminDirection] = useState('');
  const [adminOrder, setAdminOrder] = useState('direction');
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch('/api/dashboard')
      .then(async (response) => response.ok ? response.json() as Promise<Dashboard> : null)
      .then(setDashboard)
      .catch(() => undefined)
      .finally(() => setDashboardLoading(false));
  }, []);

  useEffect(() => {
    if (!previewLdap) return;
    const timer = window.setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    return () => window.clearTimeout(timer);
  }, [previewLdap]);

  const ownRows = dashboard?.rows.filter((row) => row.ldap === dashboard.viewer.ldap) || [];
  const latest = ownRows.find((row) => row.periodKey === ownPeriod) || ownRows[0];
  const isAdmin = dashboard?.viewer.role === 'admin';

  async function requestLogin() {
    setLoginPending(true);
    setLoginMessage('');
    try {
      const response = await fetch('/api/auth/request-link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ldap }) });
      const body = await response.json() as { message?: string; error?: string };
      setLoginMessage(body.message || body.error || 'Не вдалося почати вхід. Спробуйте ще раз.');
    } catch {
      setLoginMessage('Не вдалося з’єднатися з сервісом входу. Спробуйте ще раз.');
    } finally {
      setLoginPending(false);
    }
  }

  async function setOperatorAccess(profile: AccessProfile, enabled: boolean) {
    setAccessPending(profile.ldap);
    setAccessMessage('');
    try {
      const response = await fetch('/api/admin/access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ldap: profile.ldap, enabled }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося оновити доступ.');
      setDashboard((current) => current ? {
        ...current,
        accessProfiles: current.accessProfiles?.map((item) => item.ldap === profile.ldap ? { ...item, accessEnabled: enabled } : item),
      } : current);
      setAccessMessage(enabled ? `Доступ для ${profile.ldap} надано.` : `Доступ для ${profile.ldap} вимкнено.`);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'Не вдалося оновити доступ.');
    } finally {
      setAccessPending(null);
    }
  }

  async function saveIndependence(profile: AccessProfile) {
    const independence = independenceDrafts[profile.ldap] ?? profile.independence ?? '';
    setIndependencePending(profile.ldap); setAccessMessage('');
    try {
      const response = await fetch('/api/admin/independence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ldap: profile.ldap, independence }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося зберегти рівень самостійності.');
      setDashboard((current) => current ? { ...current, accessProfiles: current.accessProfiles?.map((item) => item.ldap === profile.ldap ? { ...item, independence } : item) } : current);
      setAccessMessage(`Рівень самостійності для ${profile.ldap} збережено.`);
    } catch (error) { setAccessMessage(error instanceof Error ? error.message : 'Не вдалося зберегти зміни.'); } finally { setIndependencePending(null); }
  }

  async function addHelpfulLink() {
    setLinkPending(true); setAccessMessage('');
    try {
      const response = await fetch('/api/admin/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: linkTitle, url: linkUrl, audience: linkAudience || 'ALL' }) });
      const body = await response.json() as HelpfulLink & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Не вдалося додати посилання.');
      const link: HelpfulLink = { title: body.title, url: body.url, audience: body.audience, active: body.active };
      setDashboard((current) => current ? { ...current, adminLinks: [...(current.adminLinks || []), link], helpfulLinks: link.audience === 'ALL' || link.audience === current.viewer.ldap ? [...(current.helpfulLinks || []), link] : current.helpfulLinks } : current);
      setLinkTitle(''); setLinkUrl(''); setLinkAudience('ALL'); setAccessMessage('Корисне посилання додано.');
    } catch (error) { setAccessMessage(error instanceof Error ? error.message : 'Не вдалося додати посилання.'); } finally { setLinkPending(false); }
  }

  if (!dashboard && dashboardLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb] px-4 text-slate-900">
        <div className="text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-200"><LockKeyhole className="size-6" /></div>
          <p className="mt-5 text-lg font-extrabold">Відкриваємо кабінет…</p>
          <p className="mt-1 text-sm text-slate-500">Перевіряємо безпечну сесію.</p>
        </div>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb] px-4 py-8 text-slate-900">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-200">
            <LockKeyhole className="size-6" />
          </div>
          <p className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-blue-700">KPI Кабінет</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.045em]">Вхід для оператора</h1>
          <p className="mt-3 text-base leading-6 text-slate-500">Вкажіть свій LDAP. Якщо доступ надано, бот надішле одноразове посилання в особисті повідомлення Slack.</p>
          <label className="mt-7 block text-sm font-bold text-slate-700" htmlFor="ldap">LDAP</label>
          <Input id="ldap" value={ldap} onChange={(event) => setLdap(event.target.value.toUpperCase())} placeholder="Наприклад, CC261100MAO" autoComplete="username" className="mt-2 h-12 rounded-xl" />
          {loginMessage && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600" role="status">{loginMessage}</p>}
          <Button onClick={requestLogin} disabled={loginPending || !ldap} className="mt-5 h-12 w-full rounded-xl bg-slate-950 text-sm font-bold hover:bg-slate-800">
            <LogIn className="mr-2 size-4" /> {loginPending ? 'Надсилаємо…' : 'Надіслати посилання в Slack'}
          </Button>
          <div className="mt-5 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-sm leading-5 text-blue-900"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-blue-600" /> Дані KPI з’являться лише після успішного входу.</div>
        </section>
      </main>
    );
  }

  const adminProfiles = dashboard.accessProfiles || [];
  const enabledProfiles = adminProfiles.filter((profile) => profile.accessEnabled !== false);
  const selectedProfile = adminProfiles.find((profile) => profile.ldap === previewLdap);
  const selectedRows = selectedProfile ? dashboard.rows.filter((row) => row.ldap === selectedProfile.ldap) : [];
  const selectedLinks = selectedProfile ? (dashboard.adminLinks || []).filter((link) => link.active !== false && (link.audience === 'ALL' || link.audience === selectedProfile.ldap)) : [];
  const adminPeriods = [...new Map(dashboard.rows.map((row) => [row.periodKey, row.periodLabel])).entries()].sort(([a], [b]) => b.localeCompare(a));
  const rowsForAdminPeriod = adminPeriod ? dashboard.rows.filter((row) => row.periodKey === adminPeriod) : dashboard.rows;
  const latestRowByLdap = new Map<string, DashboardRow>();
  rowsForAdminPeriod.forEach((row) => {
    if (!latestRowByLdap.has(row.ldap)) latestRowByLdap.set(row.ldap, row);
  });
  const adminDirections = [...new Set(adminProfiles.map((profile) => profile.direction).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'uk'));
  const directionPriority = (direction: string | undefined) => {
    const value = String(direction || '').toLowerCase();
    if (value.includes('телефон')) return 0;
    if (value.includes('чат')) return 1;
    return 2;
  };
  const visibleAdminProfiles = adminProfiles.filter((profile) => !adminDirection || profile.direction === adminDirection).sort((a, b) => {
    const accessDifference = Number(a.accessEnabled === false) - Number(b.accessEnabled === false);
    if (accessDifference) return accessDifference;
    if (adminOrder === 'score') return (latestRowByLdap.get(b.ldap)?.scoreNumber || -1) - (latestRowByLdap.get(a.ldap)?.scoreNumber || -1);
    if (adminOrder === 'name') return String(a.operator || '').localeCompare(String(b.operator || ''), 'uk');
    return directionPriority(a.direction) - directionPriority(b.direction) || String(a.operator || '').localeCompare(String(b.operator || ''), 'uk');
  });

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-[1560px] grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-white px-5 py-5 lg:border-b-0 lg:border-r lg:px-4 lg:py-6">
          <div className="flex items-center gap-3 px-2">
            <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-200"><TrendingUp className="size-5 text-white" /></div>
            <div><p className="text-base font-extrabold tracking-tight">KPI Кабінет</p><p className="text-xs text-slate-400">персональні робочі дані</p></div>
          </div>

          <nav className="mt-6 grid grid-cols-2 gap-1 lg:grid-cols-1">
            <NavItem icon={LayoutDashboard} label="Мої KPI" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
            <NavItem icon={UsersRound} label="Рекомендації" active={activeTab === 'recommendations'} onClick={() => setActiveTab('recommendations')} />
            {isAdmin && <NavItem icon={BookOpen} label="Адміністрування" active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} />}
          </nav>

          <div className="mt-7 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-950">
            <div className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="size-4 text-emerald-600" /> Slack-вхід підтверджено</div>
            <p className="mt-2 text-xs leading-5 text-emerald-800">Сесія захищена. Дані видимі лише відповідно до вашої ролі.</p>
          </div>

          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 lg:mt-12">
            <div className="grid size-9 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">{(dashboard.viewer.operator || 'О').slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{dashboard.viewer.operator || 'Оператор'}</p><p className="truncate text-xs text-slate-500">{dashboard.viewer.ldap}</p></div>
          </div>
        </aside>

        <section className="min-w-0 px-4 py-5 sm:px-7 sm:py-7 lg:px-10 lg:py-8">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">Ви авторизовані</span>
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700">LDAP: {dashboard.viewer.ldap}</span>
                {latest?.periodLabel && <span className="flex items-center gap-1"><CalendarDays className="size-3.5" /> {latest.periodLabel}</span>}
              </div>
              <h1 className="text-3xl font-black tracking-[-0.045em] sm:text-4xl">Вітаємо, {dashboard.viewer.operator || dashboard.viewer.ldap}</h1>
              <p className="mt-2 max-w-2xl text-base leading-6 text-slate-500">Тут показані дані, доступні для вашого LDAP. Інші оператори їх не бачать.</p>
            </div>
            <Badge variant="secondary" className="w-fit border border-slate-200 bg-white px-3 py-2 text-slate-700">{isAdmin ? 'Адміністратор' : 'Оператор'}</Badge>
          </header>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 sm:w-fit">
              <TabsTrigger value="overview" className="rounded-lg px-3 py-2 text-sm">Мої KPI</TabsTrigger>
              <TabsTrigger value="recommendations" className="rounded-lg px-3 py-2 text-sm">Рекомендації</TabsTrigger>
              {isAdmin && <TabsTrigger value="admin" className="rounded-lg px-3 py-2 text-sm">Адміністрування</TabsTrigger>}
            </TabsList>

            <TabsContent value="overview" className="mt-5">
              <OperatorPreview profile={{ ldap: dashboard.viewer.ldap, operator: dashboard.viewer.operator, direction: dashboard.viewer.direction }} rows={ownRows} links={dashboard.helpfulLinks || []} selectedPeriod={ownPeriod} onSelectPeriod={setOwnPeriod} />
            </TabsContent>

            <TabsContent value="recommendations" className="mt-5 grid gap-4 xl:grid-cols-2">
              {(latest?.recommendations || []).map((item, index) => <article key={`${item.title}-${index}`} className="rounded-2xl border border-amber-100 bg-amber-50 p-6"><GraduationCap className="size-6 text-amber-600" /><h2 className="mt-4 text-lg font-extrabold">{item.title}</h2><p className="mt-2 text-sm leading-6 text-slate-700">{item.text}</p></article>)}
              {(latest?.errorAdvice || []).map((item, index) => <article key={index} className="rounded-2xl border border-violet-100 bg-violet-50 p-6"><UsersRound className="size-6 text-violet-600" /><h2 className="mt-4 text-lg font-extrabold">Рекомендація за результатами перевірок</h2><p className="mt-2 text-sm leading-6 text-slate-700">{item}</p></article>)}
              {!(latest?.recommendations?.length || latest?.errorAdvice?.length) && <article className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600">Для поточного періоду персональних рекомендацій поки немає.</article>}
            </TabsContent>

            {isAdmin && <TabsContent value="admin" className="mt-5">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-xl font-extrabold">Доступ операторів</h2><p className="mt-1 text-sm leading-6 text-slate-500">Тут можна надати або вимкнути доступ за LDAP. Стан перевіряється сервером — вимкнений оператор не отримає посилання в Slack і не відкриє KPI.</p></div><div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm font-bold text-slate-700">Період KPI<select value={adminPeriod} onChange={(event) => setAdminPeriod(event.target.value)} className="h-10 min-w-48 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-blue-500"><option value="">Останні доступні</option>{adminPeriods.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="grid gap-1 text-sm font-bold text-slate-700">Напрямок<select value={adminDirection} onChange={(event) => setAdminDirection(event.target.value)} className="h-10 min-w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-blue-500"><option value="">Усі напрямки</option>{adminDirections.map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label><label className="grid gap-1 text-sm font-bold text-slate-700">Порядок<select value={adminOrder} onChange={(event) => setAdminOrder(event.target.value)} className="h-10 min-w-44 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-blue-500"><option value="direction">Напрямок</option><option value="score">Бал: вищий перший</option><option value="name">За ПІБ</option></select></label><Badge className="mb-0.5 w-fit bg-slate-100 text-slate-700 hover:bg-slate-100">{enabledProfiles.length} з {adminProfiles.length} активні</Badge></div></div>
                {accessMessage && <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700" role="status">{accessMessage}</p>}
                {adminProfiles.length > 0 ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[1060px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3 font-bold">Оператор</th><th className="px-3 py-3 font-bold">LDAP</th><th className="px-3 py-3 font-bold">KPI</th><th className="px-3 py-3 font-bold">Самостійність</th><th className="px-3 py-3 font-bold">Доступ</th><th className="px-3 py-3 font-bold">Дії</th></tr></thead><tbody>{visibleAdminProfiles.map((profile) => { const row = latestRowByLdap.get(profile.ldap); const accessEnabled = profile.accessEnabled !== false; const ownAdmin = profile.ldap === dashboard.viewer.ldap; const draft = independenceDrafts[profile.ldap] ?? profile.independence ?? ''; return <tr key={profile.ldap} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 font-semibold">{profile.operator || '—'}<p className="mt-0.5 text-xs font-normal text-slate-500">{profile.direction || '—'}</p></td><td className="px-3 py-3 font-mono text-xs text-slate-600">{profile.ldap}</td><td className="px-3 py-3"><p className="font-bold">{row?.scoreNumber ?? '—'}</p><p className="text-xs text-slate-500">{row?.periodLabel || 'дані не внесено'}</p></td><td className="px-3 py-3"><div className="flex min-w-56 gap-2"><Input aria-label={`Рівень самостійності ${profile.ldap}`} value={draft} onChange={(event) => setIndependenceDrafts((current) => ({ ...current, [profile.ldap]: event.target.value }))} placeholder="Наприклад, самостійно" className="h-9" /><Button type="button" size="sm" variant="outline" disabled={independencePending === profile.ldap} onClick={() => void saveIndependence(profile)}>{independencePending === profile.ldap ? '…' : 'Зберегти'}</Button></div></td><td className="px-3 py-3"><Badge className={accessEnabled ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-100'}>{accessEnabled ? 'Надано' : 'Вимкнено'}</Badge></td><td className="px-3 py-3"><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { setPreviewLdap(profile.ldap); setPreviewPeriod(''); }}>Перегляд</Button><Button type="button" size="sm" variant={accessEnabled ? 'outline' : 'default'} disabled={accessPending === profile.ldap || (ownAdmin && accessEnabled)} onClick={() => void setOperatorAccess(profile, !accessEnabled)}>{accessPending === profile.ldap ? '…' : ownAdmin && accessEnabled ? 'Ваш доступ' : accessEnabled ? 'Вимкнути' : 'Надати'}</Button></div></td></tr>; })}</tbody></table>{visibleAdminProfiles.length === 0 && <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">За цим фільтром операторів немає.</p>}</div> : <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Список операторів ще не надійшов із захищеного сервісу KPI.</p>}</article>
              <article className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-xl font-extrabold">Додати корисне посилання</h2><p className="mt-1 text-sm text-slate-500">Воно з’явиться лише для вказаного LDAP або для всіх операторів.</p><div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr_180px_auto]"><Input value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="Назва, наприклад База знань" /><Input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://…" inputMode="url" /><Input value={linkAudience} onChange={(event) => setLinkAudience(event.target.value.toUpperCase())} placeholder="ALL або LDAP" /><Button type="button" disabled={linkPending || !linkTitle || !linkUrl} onClick={() => void addHelpfulLink()}>{linkPending ? 'Додаємо…' : 'Додати'}</Button></div><p className="mt-2 text-xs text-slate-500">ALL — усім операторам. Для конкретної людини введіть її LDAP.</p></article>
              {selectedProfile && <div ref={previewRef} className="mt-5"><OperatorPreview title="Перегляд кабінету оператора" profile={selectedProfile} rows={selectedRows} links={selectedLinks} selectedPeriod={previewPeriod} onSelectPeriod={setPreviewPeriod} /></div>}
            </TabsContent>}
          </Tabs>
        </section>
      </div>
    </main>
  );
}
