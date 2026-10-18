import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** The branded card the sign-in related pages share. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-700 via-brand-600 to-sky-500 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <h1 className="text-2xl font-bold">{t('shell.productName')}</h1>
          <p className="text-sm text-white/80">{t('auth.tagline')}</p>
        </div>
        <div className="card space-y-4 p-6 shadow-xl">
          <h2 className="text-lg font-semibold">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
