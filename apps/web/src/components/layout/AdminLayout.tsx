import {
  BarChart3,
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  Gift,
  ShieldCheck,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, cn, Logo, LogoMark } from '@azhoot/ui';
import { PastDueStrip } from '@/components/billing/AccountBanner';
import { NotificationBell } from '@/components/billing/NotificationBell';
import { CreditWidget } from '@/components/billing/CreditWidget';
import { PlanWidget } from '@/components/billing/PlanWidget';
import { useAuth } from '@/lib/auth';
import { useBilling } from '@/lib/billing';
import { useTheme } from '@/lib/theme';

const BASE_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/quizzes', label: 'Quizzes', icon: ListChecks },
  { to: '/biblioteca', label: 'Apresentar', icon: BookOpen },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

const COLLAPSE_KEY = 'azhoot:sidebar-collapsed';

export function AdminLayout() {
  const { user, logout } = useAuth();
  const { data: billing } = useBilling();
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useTheme();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'), [collapsed]);
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const NAV = [
    ...BASE_NAV.slice(0, 4),
    ...(billing?.affiliateEnabled && user?.role === 'OWNER'
      ? [{ to: '/afiliado', label: 'Indique e ganhe', icon: Gift }]
      : []),
    { to: '/creditos', label: 'Créditos', icon: Sparkles },
    ...BASE_NAV.slice(4),
    ...(user?.isMaster ? [{ to: '/master', label: 'Painel master', icon: ShieldCheck }] : []),
  ];

  const nav = (
    <nav aria-label="Principal" className="grid gap-1 p-3">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-white shadow-sm'
                : 'text-slate-300 hover:bg-white/10 hover:text-white',
              collapsed && 'lg:justify-center lg:px-0',
            )
          }
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          <span className={cn(collapsed && 'lg:sr-only')}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded bg-primary px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Pular para o conteúdo
      </a>
      {/* Sidebar desktop */}
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-white/5 bg-night text-white transition-[width] duration-200 lg:flex',
          collapsed ? 'w-20' : 'w-64',
        )}
      >
        <div className={cn('flex h-16 items-center px-4', collapsed && 'justify-center px-0')}>
          {collapsed ? <LogoMark /> : <Logo inverted />}
        </div>
        {nav}
        <div className="mt-auto grid gap-3 p-3">
          <CreditWidget collapsed={collapsed} />
          <PlanWidget collapsed={collapsed} />
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? (
              <ChevronsRight className="size-5" />
            ) : (
              <>
                <ChevronsLeft className="size-5" /> Recolher
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Drawer mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-night text-white shadow-xl">
            <div className="flex h-16 items-center justify-between px-4">
              <Logo inverted />
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10"
                onClick={() => setMobileOpen(false)}
                aria-label="Fechar menu"
              >
                <X />
              </Button>
            </div>
            {nav}
            <div className="mt-auto grid gap-3 p-3">
              <CreditWidget collapsed={false} />
              <PlanWidget collapsed={false} />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu />
          </Button>
          <div className="lg:hidden">
            <LogoMark className="size-8" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              aria-label={isDark ? 'Usar tema claro' : 'Usar tema escuro'}
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
            >
              {isDark ? <Sun /> : <Moon />}
            </Button>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{user?.name}</p>
              <p className="text-xs text-muted-foreground">
                {user?.role === 'OWNER'
                  ? 'Proprietário'
                  : user?.role === 'ADMIN'
                    ? 'Administrador'
                    : 'Apresentador'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              <LogOut /> Sair
            </Button>
          </div>
        </header>
        <PastDueStrip />
        <main
          id="conteudo"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:py-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
