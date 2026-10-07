import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Banknote, CheckCircle2, LayoutGrid, MessageCircle, ScanBarcode, Sparkles, TrendingUp, UserRoundCheck, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { ITEM_ILLUSTRATIONS, svgDataUri } from '../../lib/illustrations';

const FEATURES: { key: string; icon: ReactNode; tint: string }[] = [
  { key: 'pos', icon: <LayoutGrid className="size-5" />, tint: 'from-sky-400 to-blue-600' },
  { key: 'tracking', icon: <ScanBarcode className="size-5" />, tint: 'from-violet-400 to-indigo-600' },
  { key: 'customers', icon: <MessageCircle className="size-5" />, tint: 'from-emerald-400 to-teal-600' },
  { key: 'wallet', icon: <Wallet className="size-5" />, tint: 'from-amber-300 to-orange-500' },
  { key: 'finance', icon: <Banknote className="size-5" />, tint: 'from-pink-400 to-rose-600' },
  { key: 'staff', icon: <UserRoundCheck className="size-5" />, tint: 'from-cyan-300 to-sky-600' },
];

const STATS = ['speed', 'whatsapp', 'vat', 'devices'];
const STEPS = ['one', 'two', 'three'];

const MOCK_GRID = ['thobe', 'abaya', 'shirt', 'ghutra', 'suit', 'dress', 'trousers', 'duvet', 'bisht'];
const MOCK_LINES = [
  { key: 'thobe', qty: 3, amount: '2.400' },
  { key: 'ghutra', qty: 2, amount: '1.000' },
  { key: 'duvet', qty: 1, amount: '2.900' },
];

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap';
const display = { fontFamily: "'Plus Jakarta Sans', var(--font-sans)" };

function useDisplayFont() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_URL}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    document.head.appendChild(link);
  }, []);
}

function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('grid place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-brand-600 text-white shadow-lg shadow-brand-600/30', className)}>
      <svg viewBox="0 0 24 24" className="size-[60%]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="3" />
        <circle cx="12" cy="13" r="5" />
        <path d="M9 13.5c1-1 2-1 3 0s2 1 3 0" />
        <circle cx="8" cy="5.5" r=".8" fill="currentColor" />
      </svg>
    </span>
  );
}

function Illustration({ k, className }: { k: string; className?: string }) {
  const item = ITEM_ILLUSTRATIONS[k];
  return <img src={svgDataUri(item.svg)} alt="" className={className} />;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold tracking-wider text-brand-600 uppercase">{children}</p>;
}

/** A static picture of the POS, built from the app's own garment illustrations. */
function ProductMockup() {
  const { t } = useTranslation();
  return (
    <div className="relative mx-auto w-full max-w-xl lg:max-w-none" aria-hidden="true">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-sky-500/30 via-brand-500/20 to-violet-500/30 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40">
        <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-rose-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-emerald-400" />
          <span className="ml-3 text-xs font-medium text-slate-400">{t('landing.mock.newOrder')}</span>
        </div>
        <div className="grid grid-cols-5">
          <div className="col-span-3 grid grid-cols-3 gap-2 p-3 sm:gap-3 sm:p-4">
            {MOCK_GRID.map((k, i) => (
              <div key={k} className={clsx('rounded-xl border p-1.5 text-center sm:p-2', i === 0 ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-100')}>
                <Illustration k={k} className="mx-auto size-10 sm:size-14" />
                <div className="mt-1 truncate text-[10px] font-semibold text-slate-700 sm:text-xs">{ITEM_ILLUSTRATIONS[k].label}</div>
              </div>
            ))}
          </div>
          <div className="col-span-2 flex flex-col border-l border-slate-100 bg-slate-50/60 p-3 sm:p-4">
            <div className="text-[10px] font-semibold text-slate-400 uppercase sm:text-xs">{t('landing.mock.customer')}</div>
            <div className="mb-3 text-xs font-semibold text-slate-800 sm:text-sm">+973 3311 2233</div>
            <div className="space-y-2">
              {MOCK_LINES.map((l) => (
                <div key={l.key} className="flex items-center gap-2 text-[10px] sm:text-xs">
                  <Illustration k={l.key} className="size-5 sm:size-6" />
                  <span className="flex-1 truncate text-slate-700">
                    {ITEM_ILLUSTRATIONS[l.key].label} × {l.qty}
                  </span>
                  <span className="font-semibold text-slate-900 tabular-nums">{l.amount}</span>
                </div>
              ))}
            </div>
            <div className="mt-auto pt-3">
              <div className="flex justify-between border-t border-dashed border-slate-200 pt-2 text-xs font-bold text-slate-900 sm:text-sm">
                <span>{t('landing.mock.total')}</span>
                <span className="tabular-nums">6.300</span>
              </div>
              <div className="mt-2 rounded-lg bg-brand-600 py-2 text-center text-[10px] font-semibold text-white sm:text-xs">{t('landing.mock.charge')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="landing-float absolute -bottom-6 -left-3 flex items-center gap-3 rounded-2xl border border-white/60 bg-white/95 p-3 pr-4 shadow-xl backdrop-blur sm:-left-8">
        <span className="grid size-9 place-items-center rounded-full bg-emerald-500 text-white">
          <MessageCircle className="size-4" />
        </span>
        <div>
          <div className="text-xs font-bold text-slate-900">{t('landing.mock.ready')}</div>
          <div className="text-[11px] text-slate-500">{t('landing.mock.readyBody')}</div>
        </div>
      </div>
      <div className="landing-float-slow absolute -top-5 -right-2 hidden items-center gap-3 rounded-2xl border border-white/60 bg-white/95 p-3 pr-4 shadow-xl backdrop-blur sm:-right-6 sm:flex">
        <span className="grid size-9 place-items-center rounded-full bg-violet-500 text-white">
          <ScanBarcode className="size-4" />
        </span>
        <div>
          <div className="text-xs font-bold text-slate-900">{t('landing.mock.scanned')}</div>
          <div className="text-[11px] text-slate-500">{t('landing.mock.scannedBody')}</div>
        </div>
      </div>
    </div>
  );
}

const ctaPrimary =
  'group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-brand-600 px-6 font-semibold text-white shadow-lg shadow-brand-600/40 transition hover:shadow-xl hover:shadow-brand-500/50 hover:brightness-110';
const ctaGhost = 'inline-flex h-12 items-center justify-center rounded-full px-6 font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/10';

/** Public home page for visitors who are not signed in. */
export default function LandingPage() {
  const { t } = useTranslation();
  useDisplayFont();
  const year = new Date().getFullYear();

  return (
    <div className="min-h-full overflow-x-hidden bg-white text-slate-900">
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-slate-950 text-white">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-40 left-1/2 h-[36rem] w-[56rem] -translate-x-1/2 rounded-full bg-brand-600/40 blur-3xl" />
          <div className="absolute top-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-violet-600/30 blur-3xl" />
          <div className="absolute bottom-0 -left-40 h-[24rem] w-[24rem] rounded-full bg-sky-500/20 blur-3xl" />
          <div className="landing-grid absolute inset-0 opacity-[0.15]" />
        </div>

        <header className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-5 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5 text-lg font-bold" style={display}>
            <Logo className="size-9" />
            {t('shell.productName')}
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-white/70 md:flex">
            <a href="#features" className="hover:text-white">{t('landing.nav.features')}</a>
            <a href="#how" className="hover:text-white">{t('landing.nav.how')}</a>
          </nav>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link to="/login" className="rounded-full px-4 py-2 text-white/85 hover:bg-white/10 hover:text-white">
              {t('landing.nav.signIn')}
            </Link>
            <Link to="/signup" className="hidden rounded-full bg-white px-4 py-2 text-slate-900 transition hover:bg-sky-100 sm:block">
              {t('landing.nav.getStarted')}
            </Link>
          </div>
        </header>

        <div className="mx-auto grid max-w-7xl items-center gap-16 px-4 pt-10 pb-24 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:px-8 lg:pt-20 lg:pb-32">
          <div className="landing-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-sky-200 backdrop-blur">
              <Sparkles className="size-3.5" />
              {t('landing.hero.badge')}
            </span>
            <h1 className="mt-6 text-[2.6rem] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl lg:text-[4.2rem]" style={display}>
              {t('landing.hero.titleA')}{' '}
              <span className="bg-gradient-to-r from-sky-300 via-cyan-200 to-violet-300 bg-clip-text text-transparent">{t('landing.hero.titleB')}</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">{t('landing.hero.subtitle')}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup" className={ctaPrimary}>
                {t('landing.hero.cta')}
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link to="/login" className={ctaGhost}>
                {t('landing.hero.secondary')}
              </Link>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-slate-400">
              <CheckCircle2 className="size-4 text-emerald-400" />
              {t('landing.hero.note')}
            </p>
          </div>
          <div className="landing-rise landing-delay-1">
            <ProductMockup />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="relative z-10 mx-auto -mt-12 max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-xl shadow-slate-900/5 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s} className="bg-white p-5 sm:p-7">
              <div className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl" style={display}>
                {t(`landing.stats.${s}.value`)}
              </div>
              <div className="mt-1 text-sm text-slate-500">{t(`landing.stats.${s}.label`)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl scroll-mt-8 px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>{t('landing.features.eyebrow')}</Eyebrow>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-balance sm:text-5xl" style={display}>
            {t('landing.features.title')}
          </h2>
          <p className="mt-4 text-lg text-slate-500">{t('landing.features.subtitle')}</p>
        </div>
        <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.key}
              className="group relative rounded-3xl border border-slate-200 bg-white p-7 transition duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-2xl hover:shadow-brand-900/10"
            >
              <div className={clsx('grid size-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg', f.tint)}>{f.icon}</div>
              <h3 className="mt-6 text-lg font-bold" style={display}>
                {t(`landing.features.${f.key}.title`)}
              </h3>
              <p className="mt-2 leading-relaxed text-slate-500">{t(`landing.features.${f.key}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-8 bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
          <div className="max-w-2xl">
            <Eyebrow>{t('landing.steps.eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl" style={display}>
              {t('landing.steps.title')}
            </h2>
          </div>
          <ol className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s} className="relative rounded-3xl bg-white p-7 shadow-sm ring-1 ring-slate-200">
                <span className="bg-gradient-to-br from-sky-400 to-brand-600 bg-clip-text text-5xl font-extrabold text-transparent" style={display}>
                  0{i + 1}
                </span>
                <h3 className="mt-4 text-lg font-bold" style={display}>
                  {t(`landing.steps.${s}.title`)}
                </h3>
                <p className="mt-2 leading-relaxed text-slate-500">{t(`landing.steps.${s}.body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-16 text-center text-white sm:px-16 sm:py-20">
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -top-24 left-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-brand-600/50 blur-3xl" />
            <div className="absolute -right-20 -bottom-24 h-72 w-72 rounded-full bg-violet-600/40 blur-3xl" />
          </div>
          <TrendingUp className="mx-auto size-10 text-sky-300" />
          <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-extrabold tracking-tight text-balance sm:text-5xl" style={display}>
            {t('landing.final.title')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-300">{t('landing.final.body')}</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/signup" className={ctaPrimary}>
              {t('landing.final.cta')}
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link to="/login" className={ctaGhost}>
              {t('landing.hero.secondary')}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[2fr_1fr_1fr] lg:px-8">
          <div>
            <div className="flex items-center gap-2.5 text-lg font-bold" style={display}>
              <Logo className="size-8" />
              {t('shell.productName')}
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-500">{t('landing.footer.tagline')}</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold">{t('landing.footer.product')}</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-500">
              <li><a href="#features" className="hover:text-slate-900">{t('landing.nav.features')}</a></li>
              <li><a href="#how" className="hover:text-slate-900">{t('landing.nav.how')}</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold">{t('landing.footer.account')}</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-500">
              <li><Link to="/login" className="hover:text-slate-900">{t('landing.nav.signIn')}</Link></li>
              <li><Link to="/signup" className="hover:text-slate-900">{t('landing.nav.getStarted')}</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100">
          <div className="mx-auto max-w-7xl px-4 py-6 text-xs text-slate-400 sm:px-6 lg:px-8">
            © {year} {t('landing.footer.rights')}
          </div>
        </div>
      </footer>
    </div>
  );
}
