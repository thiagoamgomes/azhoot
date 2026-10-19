import {
  BarChart3,
  Gift,
  LayoutDashboard,
  Receipt,
  Settings,
  TrendingDown,
  Users,
  Wallet,
} from 'lucide-react';
import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { cn } from '@azhoot/ui';
import { useAuth } from '@/lib/auth';

const NAV = [
  { to: '/master', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/master/usuarios', label: 'Usuários', icon: Users },
  { to: '/master/receitas', label: 'Receitas', icon: Wallet },
  { to: '/master/despesas', label: 'Despesas', icon: TrendingDown },
  { to: '/master/analiticos', label: 'Analíticos', icon: BarChart3 },
  { to: '/master/afiliados', label: 'Afiliados', icon: Gift },
  { to: '/master/configuracoes', label: 'Configurações', icon: Settings },
];

/** Painel master: apenas usuários com isMaster. Navegação secundária em abas. */
export default function MasterLayout() {
  const { user } = useAuth();
  if (!user?.isMaster) return <Navigate to="/dashboard" replace />;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 [&>*]:min-w-0">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Receipt className="size-4" aria-hidden /> Painel master
      </div>
      <nav
        aria-label="Painel master"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 pb-px"
      >
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <div>
        <Outlet />
      </div>
    </div>
  );
}
