'use client';

import { ExternalLink, GraduationCap, Lightbulb, Pin, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export type PreviewRow = {
  ldap: string; operator: string; periodKey: string; periodLabel: string; scoreNumber: number | null;
  at?: string; sl?: string; slAsa?: string; kkdPercent?: string; knowledge?: string; quality?: string; requests?: string;
  critsCount?: number; warningsCount?: number; errorsTotal?: number; recommendations?: { title: string; text: string }[];
  errorAdvice?: string[]; errorThemes?: { name: string; count: number }[]; errorExamples?: { type: string; category: string; date: string; text: string }[];
  independence?: string;
};
export type HelpfulLink = { title: string; url: string; audience: string; active?: boolean };
export type DevelopmentPlan = { ldap: string; periodKey: string; task: string; status: string };
export type KpiTarget = { direction: string; metric: string; target: string };
export type PreviewProfile = { ldap: string; operator: string; direction?: string; level?: string; status?: string; independence?: string };

function toMetricNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/\s/g, '').replace('%', '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <p className="mt-2 text-xs text-slate-500">{label}: ще немає попереднього місяця</p>;
  const positive = value > 0;
  const neutral = value === 0;
  return <p className={`mt-2 text-xs font-bold ${neutral ? 'text-slate-500' : positive ? 'text-emerald-700' : 'text-rose-700'}`}>{label}: {positive ? '+' : ''}{value.toFixed(2)}</p>;
}

function Metric({ label, value, tone = 'bg-slate-50 border-slate-200' }: { label: string; value: string | number; tone?: string }) {
  return <div className={`rounded-2xl border p-4 ${tone}`}><p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{value || '—'}</p></div>;
}

export function HelpfulLinks({ links, compact = false }: { links: HelpfulLink[]; compact?: boolean }) {
  if (!links.length) return null;
  if (compact) return <section className="mt-6 border-t border-slate-200 pt-5"><div className="flex items-center gap-2 px-2 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500"><ExternalLink className="size-3.5" /> Корисні посилання</div><div className="mt-3 grid gap-1">{links.map((link) => <a key={`${link.audience}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-blue-800 transition hover:bg-blue-50"><span className="min-w-0 truncate">{link.title}</span><ExternalLink className="size-3.5 shrink-0" /></a>)}</div></section>;
  return <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-extrabold">Корисні посилання</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{links.map((link) => <a key={`${link.audience}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800 transition hover:bg-blue-100"><span>{link.title}</span><ExternalLink className="size-4 shrink-0" /></a>)}</div></section>;
}

export function OperatorPreview({ profile, rows, links, plans = [], targets = [], title = 'Мої KPI', selectedPeriod = '', onSelectPeriod, showLinks = false }: { profile: PreviewProfile; rows: PreviewRow[]; links: HelpfulLink[]; plans?: DevelopmentPlan[]; targets?: KpiTarget[]; title?: string; selectedPeriod?: string; onSelectPeriod?: (period: string) => void; showLinks?: boolean }) {
  const latest = rows.find((row) => row.periodKey === selectedPeriod) || rows[0];
  const latestIndex = latest ? rows.findIndex((row) => row.periodKey === latest.periodKey) : -1;
  const previous = latestIndex >= 0 ? rows[latestIndex + 1] : undefined;
  const scoreDelta = latest && previous && latest.scoreNumber !== null && previous.scoreNumber !== null ? latest.scoreNumber - previous.scoreNumber : null;
  const errorDelta = latest && previous ? (latest.errorsTotal || 0) - (previous.errorsTotal || 0) : null;
  const quality = toMetricNumber(latest?.quality);
  const sl = toMetricNumber(latest?.sl);
  const kkd = toMetricNumber(latest?.kkdPercent);
  const strengths = [
    latest && latest.scoreNumber !== null && latest.scoreNumber >= 85 ? `Сильний загальний бал: ${latest.scoreNumber}` : '',
    quality !== null && quality >= 90 ? `Якість: ${latest?.quality}` : '',
    toMetricNumber(latest?.knowledge) !== null && toMetricNumber(latest?.knowledge)! >= 90 ? `Знання: ${latest?.knowledge}` : '',
    latest && (latest.errorsTotal || 0) === 0 ? 'Без крітів і зауважень у вибраному місяці' : '',
  ].filter(Boolean);
  const focusAreas = [
    latest && (latest.critsCount || 0) > 0 ? `${latest.critsCount} критів — пріоритет для розбору` : '',
    latest && (latest.warningsCount || 0) > 0 ? `${latest.warningsCount} зауважень — варто переглянути кейси` : '',
    latest && latest.scoreNumber !== null && latest.scoreNumber < 85 ? `Загальний бал ${latest.scoreNumber} — є простір для росту` : '',
    sl !== null && sl < 95 ? `SL ${latest?.sl} — перевірте своєчасність відповідей` : '',
    kkd !== null && kkd < 80 ? `ККД ${latest?.kkdPercent}% — перегляньте зайві кроки в діях` : '',
  ].filter(Boolean);
  const currentPlans = latest ? plans.filter((plan) => plan.ldap === profile.ldap && plan.periodKey === latest.periodKey) : [];
  const currentTargets = targets.filter((target) => target.direction === 'ALL' || target.direction === profile.direction);
  const metrics = [
    ['Бал', latest?.scoreNumber ?? '—', 'bg-emerald-50 border-emerald-200'], ['AT', latest?.at || '—', 'bg-emerald-50 border-emerald-200'], ['SL', latest?.sl || '—', 'bg-amber-50 border-amber-200'], ['SL ASA', latest?.slAsa || '—', 'bg-emerald-50 border-emerald-200'],
    ['ККД %', latest?.kkdPercent || '—', 'bg-amber-50 border-amber-200'], ['Знання', latest?.knowledge || '—', 'bg-emerald-50 border-emerald-200'], ['Якість', latest?.quality || '—', 'bg-emerald-50 border-emerald-200'], ['Звернень', latest?.requests || '—', 'bg-slate-50 border-slate-200'],
    ['Кріти', latest?.critsCount ?? 0, 'bg-emerald-50 border-emerald-200'], ['Зауваження', latest?.warningsCount ?? 0, 'bg-rose-50 border-rose-200'], ['Помилки', latest?.errorsTotal ?? 0, 'bg-rose-50 border-rose-200'], ['Поради', (latest?.recommendations?.length || 0) + (latest?.errorAdvice?.length || 0), 'bg-slate-50 border-slate-200'],
  ] as const;
  const trendRows = [...rows].sort((a, b) => a.periodKey.localeCompare(b.periodKey)).slice(-12);
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="border-b border-slate-100 pb-5"><p className="text-sm font-bold uppercase tracking-[0.14em] text-blue-700">{title}</p><div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-3xl font-black tracking-tight">{profile.operator || profile.ldap}</h2><p className="mt-2 text-sm text-slate-500">{latest?.periodLabel || 'Період ще не внесено'} · {profile.ldap} · {profile.direction || '—'} · {profile.level || '—'} {latest?.independence ? `· Самостійність: ${latest.independence}` : profile.independence ? `· Самостійність: ${profile.independence}` : ''}</p></div>{rows.length > 1 && <label className="grid gap-1 text-sm font-bold text-slate-700">Місяць KPI<select value={latest?.periodKey || ''} onChange={(event) => onSelectPeriod?.(event.target.value)} className="h-10 min-w-48 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-blue-500" aria-label="Оберіть місяць KPI">{rows.map((row) => <option key={row.periodKey} value={row.periodKey}>{row.periodLabel}</option>)}</select></label>}</div></div>
    {latest ? <><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value, tone]) => <Metric key={label} label={label} value={value} tone={tone} />)}</div>
      <section className="mt-7 grid gap-3 lg:grid-cols-3"><article className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><p className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">Динаміка</p><p className="mt-2 text-lg font-extrabold">Порівняння з попереднім місяцем</p><Delta label="Бал" value={scoreDelta} /><Delta label="Помилки" value={errorDelta === null ? null : -errorDelta} /></article><article className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 lg:col-span-2"><p className="text-xs font-extrabold uppercase tracking-wide text-emerald-700">Сильні зони</p>{strengths.length ? <ul className="mt-2 grid gap-1.5 text-sm font-medium text-emerald-950">{strengths.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-900">Після накопичення даних тут з’являться стабільні сильні показники.</p>}</article><article className="rounded-2xl border border-amber-100 bg-amber-50 p-5 lg:col-span-3"><p className="text-xs font-extrabold uppercase tracking-wide text-amber-700">Зони фокусу</p>{focusAreas.length ? <ul className="mt-2 grid gap-1.5 text-sm font-medium text-amber-950 sm:grid-cols-2">{focusAreas.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-sm text-amber-900">За цими даними критичних зон для фокусу не знайдено.</p>}</article></section>
      {(currentTargets.length > 0 || currentPlans.length > 0) && <section className="mt-7 grid gap-3 lg:grid-cols-2"><article className="rounded-2xl border border-blue-100 bg-blue-50 p-5"><p className="text-xs font-extrabold uppercase tracking-wide text-blue-700">Цілі KPI</p>{currentTargets.length ? <ul className="mt-3 grid gap-2 text-sm font-medium text-blue-950">{currentTargets.map((target) => <li key={`${target.direction}-${target.metric}`}>{target.metric}: <strong>{target.target}</strong></li>)}</ul> : <p className="mt-2 text-sm text-blue-900">Керівник ще не задав цілі для цього напрямку.</p>}</article><article className="rounded-2xl border border-violet-100 bg-violet-50 p-5"><p className="text-xs font-extrabold uppercase tracking-wide text-violet-700">План донавчання</p>{currentPlans.length ? <ul className="mt-3 grid gap-3">{currentPlans.map((plan, index) => <li key={`${plan.task}-${index}`} className="text-sm text-violet-950"><p className="font-bold">{plan.task}</p><Badge className="mt-1 bg-white text-violet-700 hover:bg-white">{plan.status}</Badge></li>)}</ul> : <p className="mt-2 text-sm text-violet-900">На цей місяць персональних кроків донавчання поки немає.</p>}</article></section>}
      {trendRows.length > 1 && <section className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="text-xl font-extrabold">Динаміка загального балу</h3><p className="mt-1 text-sm text-slate-500">До 12 останніх доступних місяців</p></div><Badge className="bg-white text-slate-700 hover:bg-white">{trendRows.length} міс.</Badge></div><div className="mt-6 flex h-44 items-end justify-between gap-2 border-b border-slate-200 pb-1">{trendRows.map((row) => <div key={row.periodKey} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="text-xs font-bold text-slate-600">{row.scoreNumber ?? '—'}</span><div className={`w-full max-w-11 rounded-t-lg ${row.periodKey === latest.periodKey ? 'bg-gradient-to-t from-blue-600 to-indigo-500' : 'bg-blue-200'}`} style={{ height: `${Math.max(5, Math.min(100, row.scoreNumber || 0))}%` }} /><span className="truncate text-[11px] font-medium text-slate-500">{row.periodLabel.slice(0, 3)}</span></div>)}</div></section>}
      {(latest.recommendations?.length || latest.errorAdvice?.length) ? <section className="mt-7"><h3 className="text-2xl font-extrabold">Рекомендації та донавчання</h3><div className="mt-3 grid gap-3">{latest.recommendations?.map((item, index) => <article key={`${item.title}-${index}`} className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><div className="flex items-center gap-2 font-extrabold"><Lightbulb className="size-5 text-violet-600" />{item.title}</div><p className="mt-2 text-sm leading-6 text-slate-700">{item.text}</p></article>)}{latest.errorAdvice?.map((item, index) => <article key={index} className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><div className="flex items-center gap-2 font-extrabold"><GraduationCap className="size-5 text-blue-700" />Рекомендація за результатами перевірок</div><p className="mt-2 text-sm leading-6 text-slate-700">{item}</p></article>)}</div></section> : null}
      {latest.errorThemes?.length ? <section className="mt-7"><h3 className="text-2xl font-extrabold">Структура помилок за місяць</h3><div className="mt-3 grid gap-3">{latest.errorThemes.map((item) => <div key={item.name} className="rounded-2xl border border-rose-200 bg-rose-50 p-5"><div className="flex items-center gap-2 font-extrabold"><Pin className="size-4 text-rose-600" />{item.name}</div><p className="mt-2 text-sm text-slate-600">Кількість: {item.count}</p></div>)}</div></section> : null}
      {latest.errorExamples?.length ? <section className="mt-7"><h3 className="text-2xl font-extrabold">Приклади помилок</h3><div className="mt-3 grid gap-3">{latest.errorExamples.map((item, index) => <article key={`${item.date}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex items-center gap-2 font-extrabold"><ShieldAlert className="size-5 text-amber-600" />{item.type} · {item.category}</div><p className="mt-2 text-sm leading-6 text-slate-700">{item.text}</p><p className="mt-3 text-xs font-bold text-slate-500">{item.date}</p></article>)}</div></section> : null}</> : <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Для цього оператора KPI ще не внесено.</p>}
    {showLinks && <HelpfulLinks links={links} />}
  </section>;
}
