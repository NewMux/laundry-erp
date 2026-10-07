import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Action, Module } from '@laundry/shared';
import { useAuth } from './lib/auth';
import { homePath } from './lib/nav';
import { AppShell } from './components/AppShell';
import { Loading } from './components/ui';
import LoginPage from './pages/auth/LoginPage';

const LandingPage = lazy(() => import('./pages/landing/LandingPage'));
const SignupPage = lazy(() => import('./pages/auth/SignupPage'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const PosPage = lazy(() => import('./pages/pos/PosPage'));
const OrdersPage = lazy(() => import('./pages/orders/OrdersPage'));
const BoardPage = lazy(() => import('./pages/orders/BoardPage'));
const OrderDetailPage = lazy(() => import('./pages/orders/OrderDetailPage'));
const ScanPage = lazy(() => import('./pages/orders/ScanPage'));
const DeliveryPage = lazy(() => import('./pages/orders/DeliveryPage'));
const CustomersPage = lazy(() => import('./pages/customers/CustomersPage'));
const CustomerDetailPage = lazy(() => import('./pages/customers/CustomerDetailPage'));
const ExpensesPage = lazy(() => import('./pages/finance/ExpensesPage'));
const CashPage = lazy(() => import('./pages/finance/CashPage'));
const ReportsPage = lazy(() => import('./pages/finance/ReportsPage'));
const EmployeesPage = lazy(() => import('./pages/staff/EmployeesPage'));
const EmployeeDetailPage = lazy(() => import('./pages/staff/EmployeeDetailPage'));
const AttendancePage = lazy(() => import('./pages/staff/AttendancePage'));
const PayrollPage = lazy(() => import('./pages/staff/PayrollPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));

function Guard({ perm, any, children }: { perm?: [Module, Action]; any?: [Module, Action][]; children: ReactNode }) {
  const { can } = useAuth();
  const ok = perm ? can(perm[0], perm[1]) : any ? any.some(([m, a]) => can(m, a)) : true;
  if (!ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function TenantApp() {
  const { can } = useAuth();
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Navigate to={homePath(can)} replace />} />
          <Route path="/dashboard" element={<Guard perm={['dashboard', 'view']}><DashboardPage /></Guard>} />
          <Route path="/pos" element={<Guard perm={['pos', 'create']}><PosPage /></Guard>} />
          <Route path="/orders" element={<Guard any={[['pos', 'view'], ['tracking', 'view'], ['delivery', 'view']]}><OrdersPage /></Guard>} />
          <Route path="/orders/board" element={<Guard perm={['tracking', 'view']}><BoardPage /></Guard>} />
          <Route path="/orders/:id" element={<Guard any={[['pos', 'view'], ['tracking', 'view'], ['delivery', 'view']]}><OrderDetailPage /></Guard>} />
          <Route path="/scan" element={<Guard perm={['tracking', 'view']}><ScanPage /></Guard>} />
          <Route path="/delivery" element={<Guard perm={['delivery', 'view']}><DeliveryPage /></Guard>} />
          <Route path="/customers" element={<Guard perm={['customers', 'view']}><CustomersPage /></Guard>} />
          <Route path="/customers/:id" element={<Guard any={[['customers', 'view'], ['wallet', 'view']]}><CustomerDetailPage /></Guard>} />
          <Route path="/finance/expenses" element={<Guard perm={['expenses', 'view']}><ExpensesPage /></Guard>} />
          <Route path="/finance/cash" element={<Guard perm={['cash_closing', 'view']}><CashPage /></Guard>} />
          <Route path="/reports" element={<Guard any={[['reports', 'view'], ['finance_reports', 'view']]}><ReportsPage /></Guard>} />
          <Route path="/reports/:key" element={<Guard any={[['reports', 'view'], ['finance_reports', 'view']]}><ReportsPage /></Guard>} />
          <Route path="/staff/employees" element={<Guard perm={['staff', 'view']}><EmployeesPage /></Guard>} />
          <Route path="/staff/employees/:id" element={<Guard perm={['staff', 'view']}><EmployeeDetailPage /></Guard>} />
          <Route path="/staff/attendance" element={<Guard perm={['attendance', 'view']}><AttendancePage /></Guard>} />
          <Route path="/staff/payroll" element={<Guard perm={['payroll', 'view']}><PayrollPage /></Guard>} />
          <Route path="/settings/*" element={<Guard any={[['settings', 'view'], ['catalog', 'view'], ['users', 'view'], ['audit', 'view']]}><SettingsPage /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

export function App() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  const user = me?.user;
  if (loc.pathname === '/signup') {
    return (
      <Suspense fallback={<Loading />}>
        <SignupPage />
      </Suspense>
    );
  }
  if (!user) {
    if (loc.pathname === '/') {
      return (
        <Suspense fallback={<Loading />}>
          <LandingPage />
        </Suspense>
      );
    }
    if (loc.pathname !== '/login') return <Navigate to={`/login${loc.search}`} replace />;
    return <LoginPage />;
  }
  if (loc.pathname === '/login') return <Navigate to="/" replace />;
  if (user.isSuperAdmin && !me?.tenant) {
    return (
      <Suspense fallback={<Loading />}>
        <AdminPage />
      </Suspense>
    );
  }
  return <TenantApp />;
}
