import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KPI Кабінет',
  description: 'Персональний кабінет KPI для операторів, менеджерів і керівників.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="uk"><body>{children}</body></html>;
}
