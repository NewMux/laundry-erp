import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Banknote, LayoutGrid, ScanBarcode, Users, UserRoundCheck, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';

const FEATURES: { key: string; icon: ReactNode }[] = [
  { key: 'pos', icon: <LayoutGrid className="size-5" /> },
  { key: 'tracking', icon: <ScanBarcode className="size-5" /> },
  { key: 'customers', icon: <Users className="size-5" /> },
  { key: 'wallet', icon: <Wallet className="size-5" /> },
  { key: 'finance', icon: <Banknote className="size-5" /> },
  { key: 'staff', icon: <UserRoundCheck className="size-5" /> },
];

const STEPS = ['one', 'two', 'three'];

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="3" />
      <circle cx="12" cy="13" r="5" />
      <path d="M9 13.5c1-1 2-1 3 0s2 1 3 0" />
      <circle cx="8" cy="5.5" r=".8" fill="currentColor" />
    </svg>
  );
}

const primaryCta = 'inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 font-semibold text-brand-700 shadow-lg transition hover:bg-brand-50';
const secondaryCta = 'inline-flex h-12 items-center justify-center rounded-xl px-5 font-semibold text-white ring-1 ring-white/40 transition hover:bg-white/10';

/** Public home page for visitors who are not signed in. */
export default function LandingPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-full bg-white">
      <section className="bg-gradient-to-br from-brand-700 via-brand-600 to-sky-500 text-white">
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <span className="grid size-9 place-items-center rounded-xl bg-white/15 ring-1 ring-white/30">
              <Logo />
            </span>
            {t('shell.productName')}
          </Link>
          <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-2">
            <Link to="/login" className="rounded-lg px-3 py-2 hover:bg-white/10">
              {t('landing.nav.signIn')}
            </Link>
            <Link to="/signup" className="hidden rounded-lg bg-white px-3 py-2 text-brand-700 hover:bg-brand-50 sm:block">
              {t('landing.nav.startTrial')}
            </Link>
          </nav>
        </header>
        <div className="mx-auto max-w-6xl px-4 pt-12 pb-20 sm:px-6 sm:pt-20 sm:pb-28">
          <p className="text-sm font-semibold tracking-wide text-white/80 uppercase">{t('landing.hero.eyebrow')}</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">{t('landing.hero.title')}</h1>
          <p className="mt-5 max-w-2xl text-lg text-white/85">{t('landing.hero.subtitle')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/signup" className={primaryCta}>
              {t('landing.hero.cta')}
              <ArrowRight className="size-4" />
            </Link>
            <Link to="/login" className={secondaryCta}>
              {t('landing.hero.secondary')}
            </Link>
          </div>
          <p className="mt-4 text-sm text-white/75">{t('landing.hero.note')}</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="max-w-2xl text-2xl font-bold tracking-tight text-balance sm:text-3xl">{t('landing.features.title')}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.key} className="card p-5">
              <div className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-700">{f.icon}</div>
              <h3 className="mt-4 font-semibold">{t(`landing.features.${f.key}.title`)}</h3>
              <p className="mt-1 text-sm text-slate-600">{t(`landing.features.${f.key}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('landing.steps.title')}</h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s}>
                <span className="grid size-9 place-items-center rounded-full bg-brand-600 font-semibold text-white">{i + 1}</span>
                <h3 className="mt-3 font-semibold">{t(`landing.steps.${s}.title`)}</h3>
                <p className="mt-1 text-sm text-slate-600">{t(`landing.steps.${s}.body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-600 px-6 py-10 text-white sm:px-10">
          <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{t('landing.final.title')}</h2>
          <p className="mt-3 max-w-2xl text-white/85">{t('landing.final.body')}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link to="/signup" className={primaryCta}>
              {t('landing.hero.cta')}
              <ArrowRight className="size-4" />
            </Link>
            <Link to="/login" className={secondaryCta}>
              {t('landing.hero.secondary')}
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-500 sm:px-6">
          © {new Date().getFullYear()} {t('landing.footer')}
        </div>
      </footer>
    </div>
  );
}
