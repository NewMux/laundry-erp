import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Button, ErrorBox, Field, Input } from '../../components/ui';
import { AuthShell } from './AuthShell';

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t('auth.resetTitle')}>
      {done ? (
        <p className="text-sm text-slate-700">{t('auth.resetDone')}</p>
      ) : !token ? (
        <>
          <p className="text-sm text-slate-700">{t('auth.resetMissing')}</p>
          <Link to="/forgot-password" className="text-sm font-semibold text-brand-700 underline">
            {t('auth.resetRequestNew')}
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('auth.newPassword')}>
            <Input type="password" required minLength={8} autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" size="lg" block loading={busy}>
            {t('auth.resetSave')}
          </Button>
          {!!error && (
            <Link to="/forgot-password" className="block text-center text-sm font-semibold text-brand-700 underline">
              {t('auth.resetRequestNew')}
            </Link>
          )}
        </form>
      )}
      <p className="text-center text-sm">
        <Link to="/login" className="font-semibold text-brand-700 underline">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
