import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TenantSettings } from '@laundry/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../components/toast';

/** Load the shop settings, edit locally, save the whole settings object. */
export function useSettingsForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { refresh, can, readOnly } = useAuth();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/api/settings') });
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  useEffect(() => {
    if (q.data?.settings) setSettings(q.data.settings);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (s: TenantSettings) => api.put('/api/settings/preferences', s),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void refresh();
    },
    onError: (e) => toast.error(e),
  });
  return { q, settings, setSettings, save, canEdit: can('settings', 'edit') && !readOnly };
}
