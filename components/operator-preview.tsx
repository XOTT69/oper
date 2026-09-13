'use client';

import { ExternalLink, GraduationCap, Lightbulb, Pin, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export type PreviewRow = {
  ldap: string; operator: string; periodKey: string; periodLabel: string; scoreNumber: number | null;
  at?: string; sl?: string; slAsa?: string; kkdPercent?: string; knowledge?: string; quality?: string; requests?: string;
  critsCount?: number; warningsCount?: number; errorsTotal?: number; recommendations?: { title: string; text: string }[];
  errorAdvice?: string[]; errorThemes?: { name: string; count: number }[]; errorExamples?: { type: string; category: string; date: string; text: string }[];
};
export type HelpfulLink = { title: string; url: string; audience: string; active?: boolean };
export type PreviewProfile = { ldap: string; operator: string; direction?: string; level?: string; status?: string; independence?: string };

function Metric({ label, value, tone = 'bg-slate-50 border-slate-200' }: { label: string; value: string | number; tone?: string }) {
  return <div className={`rounded-2xl border p-4 ${tone}`}><p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{value || '—'}</p></div>;
}

export function HelpfulLinks({ links }: { links: HelpfulLink[] }) {
  if (!links.length) return null;
  return <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-extrabold">Корисні посилання</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{links.map((link) => <a key={`${link.audience}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800 transition hover:bg-blue-100"><span>{link.title}</span><ExternalLink className="size-4 shrink-0" /></a>)}</div></section>;
}

export function OperatorPreview({ profile, rows, links, title = 'Мої KPI', selectedPeriod = '', onSelectPeriod }: { profile: PreviewProfile; rows: PreviewRow[]; links: HelpfulLink[]; title?: string; selectedPeriod?: string; onSelectPeriod?: (period: string) => void }) {
  const latest = rows.find((row) => row.periodKey === selectedPeriod) || rows[0];
  const metrics = [
    ['Бал', latest?.scoreNumber ?? '—', 'bg-emerald-50 border-emerald-200'], ['AT', latest?.at || '—', 'bg-emerald-50 border-emerald-200'], ['SL', latest?.sl || '—', 'bg-amber-50 border-amber-200'], ['SL ASA', latest?.slAsa || '—', 'bg-emerald-50 border-emerald-200'],
    ['ККД %', latest?.kkdPercent || '—', 'bg-amber-50 border-amber-200'], ['Знання', latest?.knowledge || '—', 'bg-emerald-50 border-emerald-200'], ['Якість', latest?.quality || '—', 'bg-emerald-50 border-emerald-200'], ['Звернень', latest?.requests || '—', 'bg-slate-50 border-slate-200'],
    ['Кріти', latest?.critsCount ?? 0, 'bg-emerald-50 border-emerald-200'], ['Зауваження', latest?.warningsCount ?? 0, 'bg-rose-50 border-rose-200'], ['Помилки', latest?.errorsTotal ?? 0, 'bg-rose-50 border-rose-200'], ['Поради', (latest?.recommendations?.length || 0) + (latest?.errorAdvice?.length || 0), 'bg-slate-50 border-slate-200'],
  ] as const;
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="border-b border-slate-100 pb-5"><p className="text-sm font-bold uppercase tracking-[0.14em] text-blue-700">{title}</p><div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-3xl font-black tracking-tight">{profile.operator || profile.ldap}</h2><p className="mt-2 text-sm text-slate-500">{latest?.periodLabel || 'Період ще не внесено'} · {profile.ldap} · {profile.direction || '—'} · {profile.level || '—'} {profile.independence ? `· Самостійність: ${profile.independence}` : ''}</p></div>{rows.length > 1 && <label className="grid gap-1 text-sm font-bold text-slate-700">Місяць KPI<select value={latest?.periodKey || ''} onChange={(event) => onSelectPeriod?.(event.target.value)} className="h-10 min-w-48 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-blue-500" aria-label="Оберіть місяць KPI">{rows.map((row) => <option key={row.periodKey} value={row.periodKey}>{row.periodLabel}</option>)}</select></label>}</div></div>
    {latest ? <><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value, tone]) => <Metric key={label} label={label} value={value} tone={tone} />)}</div>
      {(latest.recommendations?.length || latest.errorAdvice?.length) ? <section className="mt-7"><h3 className="text-2xl font-extrabold">Рекомендації та донавчання</h3><div className="mt-3 grid gap-3">{latest.recommendations?.map((item, index) => <article key={`${item.title}-${index}`} className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><div className="flex items-center gap-2 font-extrabold"><Lightbulb className="size-5 text-violet-600" />{item.title}</div><p className="mt-2 text-sm leading-6 text-slate-700">{item.text}</p></article>)}{latest.errorAdvice?.map((item, index) => <article key={index} className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><div className="flex items-center gap-2 font-extrabold"><GraduationCap className="size-5 text-blue-700" />Рекомендація за результатами перевірок</div><p className="mt-2 text-sm leading-6 text-slate-700">{item}</p></article>)}</div></section> : null}
      {latest.errorThemes?.length ? <section className="mt-7"><h3 className="text-2xl font-extrabold">Структура помилок за місяць</h3><div className="mt-3 grid gap-3">{latest.errorThemes.map((item) => <div key={item.name} className="rounded-2xl border border-rose-200 bg-rose-50 p-5"><div className="flex items-center gap-2 font-extrabold"><Pin className="size-4 text-rose-600" />{item.name}</div><p className="mt-2 text-sm text-slate-600">Кількість: {item.count}</p></div>)}</div></section> : null}
      {latest.errorExamples?.length ? <section className="mt-7"><h3 className="text-2xl font-extrabold">Приклади помилок</h3><div className="mt-3 grid gap-3">{latest.errorExamples.map((item, index) => <article key={`${item.date}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex items-center gap-2 font-extrabold"><ShieldAlert className="size-5 text-amber-600" />{item.type} · {item.category}</div><p className="mt-2 text-sm leading-6 text-slate-700">{item.text}</p><p className="mt-3 text-xs font-bold text-slate-500">{item.date}</p></article>)}</div></section> : null}</> : <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Для цього оператора KPI ще не внесено.</p>}
    <HelpfulLinks links={links} />
  </section>;
}
