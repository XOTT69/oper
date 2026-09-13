'use client';

import {
  BookOpen,
  CalendarDays,
  ExternalLink,
  GraduationCap,
  House,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Recommendation = { title: string; text: string };
type ErrorTheme = { name: string; count: number };
type DashboardRow = {
  ldap: string;
  operator: string;
  periodLabel: string;
  scoreNumber: number | null;
  quality: string;
  kkdPercent: string;
  requests: string;
  periodKey: string;
  recommendations?: Recommendation[];
  errorAdvice?: string[];
  errorThemes?: ErrorTheme[];
  critsCount?: number;
  warningsCount?: number;
};
type AccessProfile = { ldap: string; operator: string; direction?: string; team?: string; role?: string; hasKpi?: boolean };
type Dashboard = {
  viewer: { ldap: string; operator: string; role: string; direction?: string; team?: string };
  rows: DashboardRow[];
  latestPeriodKey?: string;
  accessProfiles?: AccessProfile[];
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

  useEffect(() => {
    void fetch('/api/dashboard')
      .then(async (response) => response.ok ? response.json() as Promise<Dashboard> : null)
      .then(setDashboard)
      .catch(() => undefined)
      .finally(() => setDashboardLoading(false));
  }, []);

  const ownRows = dashboard?.rows.filter((row) => row.ldap === dashboard.viewer.ldap) || [];
  const latest = ownRows[0];
  const visibleMetrics = [
    { label: 'Загальний бал', value: latest?.scoreNumber?.toString() || '—', note: 'за поточний період', tone: 'text-emerald-700' },
    { label: 'Якість', value: latest?.quality || '—', note: 'за поточний період', tone: 'text-emerald-700' },
    { label: 'ККД', value: latest?.kkdPercent || '—', note: 'за поточний період', tone: 'text-emerald-700' },
    { label: 'Звернення', value: latest?.requests || '—', note: 'за поточний період', tone: 'text-slate-500' },
  ];
  const visibleMonthlyData = ownRows.slice(0, 6).reverse().map((row) => ({ score: row.scoreNumber || 0, label: row.periodLabel.slice(0, 3) }));
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
  const latestRowByLdap = new Map<string, DashboardRow>();
  dashboard.rows.forEach((row) => {
    if (!latestRowByLdap.has(row.ldap)) latestRowByLdap.set(row.ldap, row);
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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {visibleMetrics.map((metric) => (
                  <article key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm font-medium text-slate-500">{metric.label}</p><div className="mt-3 flex items-end justify-between gap-3"><p className="text-3xl font-black tracking-[-0.05em]">{metric.value}</p><p className={`pb-1 text-xs font-bold ${metric.tone}`}>{metric.note}</p></div></article>
                ))}
              </div>

              <article className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-start justify-between gap-4"><div><p className="text-lg font-extrabold tracking-tight">Динаміка загального балу</p><p className="mt-1 text-sm text-slate-500">За доступні періоди KPI</p></div>{visibleMonthlyData.length > 0 && <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">{visibleMonthlyData.length} періодів</Badge>}</div>
                {visibleMonthlyData.length > 0 ? <div className="mt-8 flex h-44 items-end justify-between gap-3 border-b border-slate-100 pb-1">{visibleMonthlyData.map((item, index) => <div key={`${item.label}-${index}`} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-xs font-bold text-slate-600">{item.score || '—'}</span><div className={`w-full max-w-10 rounded-t-xl ${index === visibleMonthlyData.length - 1 ? 'bg-gradient-to-t from-blue-600 to-indigo-500' : 'bg-blue-100'}`} style={{ height: `${Math.min(100, Math.max(4, item.score))}%` }} /><span className="text-[11px] font-medium text-slate-400">{item.label}</span></div>)}</div> : <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Для вашого LDAP ще немає внесених KPI. Коли дані з’являться у таблиці, вони підтягнуться сюди автоматично.</p>}
              </article>
            </TabsContent>

            <TabsContent value="recommendations" className="mt-5 grid gap-4 xl:grid-cols-2">
              {(latest?.recommendations || []).map((item, index) => <article key={`${item.title}-${index}`} className="rounded-2xl border border-amber-100 bg-amber-50 p-6"><GraduationCap className="size-6 text-amber-600" /><h2 className="mt-4 text-lg font-extrabold">{item.title}</h2><p className="mt-2 text-sm leading-6 text-slate-700">{item.text}</p></article>)}
              {(latest?.errorAdvice || []).map((item, index) => <article key={index} className="rounded-2xl border border-violet-100 bg-violet-50 p-6"><UsersRound className="size-6 text-violet-600" /><h2 className="mt-4 text-lg font-extrabold">Рекомендація за результатами перевірок</h2><p className="mt-2 text-sm leading-6 text-slate-700">{item}</p></article>)}
              {!(latest?.recommendations?.length || latest?.errorAdvice?.length) && <article className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600">Для поточного періоду персональних рекомендацій поки немає.</article>}
            </TabsContent>

            {isAdmin && <TabsContent value="admin" className="mt-5">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-xl font-extrabold">Доступ операторів</h2><p className="mt-1 text-sm leading-6 text-slate-500">Нижче — LDAP, яким надано доступ, і останні доступні KPI. Доступ перевіряється сервером, а не браузером.</p></div><Badge className="w-fit bg-slate-100 text-slate-700 hover:bg-slate-100">{adminProfiles.length} операторів</Badge></div>
                {adminProfiles.length > 0 ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3 font-bold">Оператор</th><th className="px-3 py-3 font-bold">LDAP</th><th className="px-3 py-3 font-bold">Напрямок</th><th className="px-3 py-3 font-bold">Останній період</th><th className="px-3 py-3 font-bold">Бал</th></tr></thead><tbody>{adminProfiles.map((profile) => { const row = latestRowByLdap.get(profile.ldap); return <tr key={profile.ldap} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3 font-semibold">{profile.operator || '—'}</td><td className="px-3 py-3 font-mono text-xs text-slate-600">{profile.ldap}</td><td className="px-3 py-3 text-slate-600">{profile.direction || '—'}</td><td className="px-3 py-3 text-slate-600">{row?.periodLabel || 'дані не внесено'}</td><td className="px-3 py-3 font-bold">{row?.scoreNumber ?? '—'}</td></tr>; })}</tbody></table></div> : <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Список доступів ще не надійшов із захищеного сервісу KPI.</p>}</article>
            </TabsContent>}
          </Tabs>
        </section>
      </div>
    </main>
  );
}
