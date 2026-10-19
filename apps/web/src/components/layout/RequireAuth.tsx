import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Permission } from '@azhoot/contracts';
import { Spinner } from '@azhoot/ui';
import { useAuth } from '@/lib/auth';
import { AccessDenied } from '@/pages/NotFoundPage';

export function RequireAuth({ permission }: { permission?: Permission }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner className="min-h-dvh" />;
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // Após reset de senha pelo master: obriga a troca antes de qualquer outra tela.
  if (user.mustChangePassword && location.pathname !== '/trocar-senha')
    return <Navigate to="/trocar-senha" replace />;
  if (permission && !can(permission)) return <AccessDenied />;
  return <Outlet />;
}
