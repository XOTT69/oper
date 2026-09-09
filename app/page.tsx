'use client';

import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  GraduationCap,
  House,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const monthlyData = [72, 76, 79, 78, 83, 87];

const metrics = [
  { label: 'Загальний бал', value: '87', note: '+4 за місяць', tone: 'text-emerald-700' },
  { label: 'Якість', value: '92%', note: 'вище цілі', tone: 'text-emerald-700' },
  { label: 'ККД', value: '81%', note: '+3 п.п.', tone: 'text-emerald-700' },
  { label: 'Звернення', value: '426', note: 'за вересень', tone: 'text-slate-500' },
];

const materials = [
  { title: 'Робота зі складними зверненнями', tag: 'Відео · 18 хв', action: 'Переглянути' },
  { title: 'Чекліст перевірки заявки', tag: 'Інструкція · 6 хв', action: 'Відкрити' },
  { title: 'Оновлення продуктів: вересень', tag: 'База знань · 12 хв', action: 'Вивчити' },
];

function NavItem({ icon: Icon, label, active = false }: { icon: typeof House; label: string; active?: boolean }) {
  return (
    <button
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
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool?: (tool: unknown, options?: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'complete_daily_kpi_task',
          title: 'Позначити міні-завдання виконаним',
          description: 'Позначає видиме міні-завдання оператора на сьогодні як виконане.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: () => {
            setCompleted(true);
            return { status: 'completed' };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, []);

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-[1560px] grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-white px-5 py-5 lg:border-b-0 lg:border-r lg:px-4 lg:py-6">
          <div className="flex items-center justify-between px-2 lg:block">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-200">
                <TrendingUp className="size-5 text-white" />
              </div>
              <div>
                <p className="text-base font-extrabold tracking-tight">KPI Кабінет</p>
                <p className="text-xs text-slate-400">твій робочий простір</p>
              </div>
            </div>
            <Badge variant="secondary" className="border border-amber-200 bg-amber-50 text-amber-700 lg:mt-7">
              Демо
            </Badge>
          </div>

          <nav className="mt-6 grid grid-cols-2 gap-1 lg:grid-cols-1">
            <NavItem icon={LayoutDashboard} label="Огляд" active />
            <NavItem icon={Target} label="Мої цілі" />
            <NavItem icon={BookOpen} label="Матеріали" />
            <NavItem icon={MessageSquareText} label="Зворотний зв’язок" />
          </nav>

          <div className="mt-8 hidden rounded-2xl bg-slate-950 p-4 text-white lg:block">
            <div className="flex items-center gap-2 text-sm font-bold"><Sparkles className="size-4 text-amber-300" /> Фокус місяця</div>
            <p className="mt-2 text-sm leading-5 text-slate-300">Зменшити кількість критів за заявками та ХД.</p>
            <button className="mt-4 flex items-center gap-1 text-xs font-bold text-blue-300 hover:text-white">Переглянути план <ArrowUpRight className="size-3" /></button>
          </div>

          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 lg:mt-auto lg:translate-y-[310px]">
            <div className="grid size-9 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">О</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">Оператор</p>
              <p className="truncate text-xs text-slate-500">вхід через Slack</p>
            </div>
            <ChevronRight className="size-4 text-slate-400" />
          </div>
        </aside>

        <section className="min-w-0 px-4 py-5 sm:px-7 sm:py-7 lg:px-10 lg:py-8">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700">Особистий кабінет</span>
                <span className="flex items-center gap-1"><CalendarDays className="size-3.5" /> Вересень 2026</span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.045em] sm:text-4xl">Доброго дня, Операторе</h1>
              <p className="mt-2 max-w-2xl text-base leading-6 text-slate-500">Твій результат зростає. Залишилось закріпити сильні сторони й прибрати повторювані помилки.</p>
            </div>
            <Button className="h-11 rounded-xl bg-slate-950 px-4 text-sm font-bold hover:bg-slate-800">
              <LogIn className="mr-2 size-4" /> Увійти через Slack
            </Button>
          </header>

          <div className="mt-7 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 text-sm text-blue-900 sm:flex sm:items-center sm:justify-between">
            <span className="flex items-center gap-2"><ShieldCheck className="size-4 shrink-0 text-blue-600" /> Це макет без реальних даних. Після входу дані будуть доступні лише тобі та твоїм керівникам.</span>
            <span className="mt-2 flex shrink-0 items-center gap-1 text-xs font-bold text-blue-700 sm:mt-0"><LockKeyhole className="size-3.5" /> Захищений доступ</span>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <article key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-medium text-slate-500">{metric.label}</p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <p className="text-3xl font-black tracking-[-0.05em]">{metric.value}</p>
                  <p className={`pb-1 text-xs font-bold ${metric.tone}`}>{metric.note}</p>
                </div>
              </article>
            ))}
          </div>

          <Tabs defaultValue="overview" className="mt-8">
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 sm:w-fit">
              <TabsTrigger value="overview" className="rounded-lg px-3 py-2 text-sm">Огляд</TabsTrigger>
              <TabsTrigger value="recommendations" className="rounded-lg px-3 py-2 text-sm">Рекомендації</TabsTrigger>
              <TabsTrigger value="materials" className="rounded-lg px-3 py-2 text-sm">Матеріали</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-lg font-extrabold tracking-tight">Динаміка загального балу</p><p className="mt-1 text-sm text-slate-500">Квітень — вересень 2026</p></div>
                  <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50"><TrendingUp className="mr-1 size-3" /> +15</Badge>
                </div>
                <div className="mt-8 flex h-44 items-end justify-between gap-3 border-b border-slate-100 pb-1">
                  {monthlyData.map((score, index) => (
                    <div key={score} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                      <span className="text-xs font-bold text-slate-600">{score}</span>
                      <div className={`w-full max-w-10 rounded-t-xl ${index === monthlyData.length - 1 ? 'bg-gradient-to-t from-blue-600 to-indigo-500' : 'bg-blue-100'}`} style={{ height: `${score}%` }} />
                      <span className="text-[11px] font-medium text-slate-400">{['Кві','Тра','Чер','Лип','Сер','Вер'][index]}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-center justify-between"><div><p className="text-lg font-extrabold tracking-tight">Ціль місяця</p><p className="mt-1 text-sm text-slate-500">Завершити до 30 вересня</p></div><Target className="size-5 text-blue-600" /></div>
                <p className="mt-6 text-sm font-bold leading-5">Підвищити якість обробки заявок</p>
                <Progress value={68} className="mt-3 h-2.5 bg-slate-100" />
                <div className="mt-2 flex justify-between text-xs"><span className="text-slate-500">Виконано</span><span className="font-bold text-slate-700">68%</span></div>
                <button className="mt-6 flex items-center gap-1.5 text-sm font-bold text-blue-700 hover:text-blue-900">Відкрити план <ChevronRight className="size-4" /></button>
              </article>
            </TabsContent>

            <TabsContent value="recommendations" className="mt-5 grid gap-5 xl:grid-cols-2">
              <article className="rounded-2xl border border-amber-100 bg-amber-50 p-6"><CircleHelp className="size-6 text-amber-600" /><h2 className="mt-4 text-lg font-extrabold">Фокус на заявках</h2><p className="mt-2 text-sm leading-6 text-slate-600">Перед закриттям звернення перевіряй коментар, прикріплені дані та наступний крок для клієнта.</p><button className="mt-5 text-sm font-bold text-amber-700">Відкрити чекліст →</button></article>
              <article className="rounded-2xl border border-violet-100 bg-violet-50 p-6"><UsersRound className="size-6 text-violet-600" /><h2 className="mt-4 text-lg font-extrabold">Фідбек керівника</h2><p className="mt-2 text-sm leading-6 text-slate-600">Ти добре тримаєш темп. Наступний крок — упевнено проводити клієнта через складні кейси.</p><button className="mt-5 text-sm font-bold text-violet-700">Написати керівнику →</button></article>
            </TabsContent>

            <TabsContent value="materials" className="mt-5 grid gap-3">
              {materials.map((item, index) => (
                <article key={item.title} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:p-5">
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">{index === 0 ? <GraduationCap className="size-5" /> : <BookOpen className="size-5" />}</div>
                  <div className="min-w-0 flex-1"><h2 className="font-bold">{item.title}</h2><p className="mt-1 text-sm text-slate-500">{item.tag}</p></div>
                  <Button variant="outline" className="rounded-xl border-slate-200 font-bold">{item.action} <ExternalLink className="ml-2 size-3.5" /></Button>
                </article>
              ))}
            </TabsContent>
          </Tabs>

          <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-6">
            <div className="flex gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Check className="size-5" /></div><div><h2 className="font-extrabold">Міні-завдання на сьогодні</h2><p className="mt-1 text-sm leading-5 text-slate-500">Пройди чекліст перед закриттям трьох наступних заявок.</p></div></div>
            <Button onClick={() => setCompleted(!completed)} variant={completed ? 'secondary' : 'default'} className="mt-4 rounded-xl font-bold sm:mt-0">{completed ? 'Позначено виконаним' : 'Позначити виконаним'}</Button>
          </article>
        </section>
      </div>
    </main>
  );
}
