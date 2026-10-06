import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can as canFn, hasCap as hasCapFn, type Action, type Cap, type Module, type Permissions, type TenantSettings } from '@laundry/shared';
import { api, onApiError } from './api';

export interface Me {
  user: { id: string; name: string; username: string; email: string | null; isSuperAdmin: boolean; employeeId: string | null } | null;
  supportMode?: boolean;
  role?: { key: string; name: string } | null;
  permissions?: Permissions;
  tenant?: {
    id: string;
    slug: string;
    name: string;
    logoFileId: string | null;
    vatNumber: string | null;
    crNumber: string | null;
    address: string | null;
    phone: string | null;
    workingHours: unknown;
    settings: TenantSettings;
    plan: { name: string; code: string } | null;
    features: { customPermissions: boolean; dataExport: boolean } | null;
  } | null;
  subscription?: { state: string; readOnly: boolean; endsAt: string | null; daysLeft: number | null; showBanner: boolean } | null;
  canCheckIn?: boolean;
  isOwner?: boolean;
}

interface AuthCtx {
  me: Me | undefined;
  loading: boolean;
  refresh: () => Promise<unknown>;
  can: (module: Module, action?: Action) => boolean;
  hasCap: (cap: Cap) => boolean;
  settings: TenantSettings | undefined;
  readOnly: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me'), staleTime: 60_000, refetchInterval: 5 * 60_000 });

  useEffect(
    () =>
      onApiError((e) => {
        if (e.status === 401 && e.code === 'UNAUTHENTICATED') void qc.invalidateQueries({ queryKey: ['me'] });
        if (e.status === 402 && e.code === 'READ_ONLY') void qc.invalidateQueries({ queryKey: ['me'] });
      }),
    [qc],
  );

  const value = useMemo<AuthCtx>(() => {
    const me = q.data;
    const perms = me?.permissions;
    return {
      me,
      loading: q.isLoading,
      refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
      can: (m, a = 'view') => canFn(perms, m, a),
      hasCap: (c) => hasCapFn(perms, c),
      settings: me?.tenant?.settings,
      readOnly: !!me?.subscription?.readOnly && !me?.supportMode,
    };
  }, [q.data, q.isLoading, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
