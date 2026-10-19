import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { passwordSchema } from '@azhoot/contracts';
import { Alert, Button, Field, Input, Logo } from '@azhoot/ui';
import { api, ApiError, describeError } from '@/lib/api';
import { ME_KEY, useAuth } from '@/lib/auth';

/** Troca de senha obrigatória (após reset pelo master). Sem esta troca, o painel fica bloqueado. */
export default function ChangePasswordPage() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      api('/auth/password', { body: { currentPassword: current, newPassword: next } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate('/dashboard', { replace: true });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === 'INVALID_CREDENTIALS'
          ? 'Senha atual (ou temporária) incorreta.'
          : describeError(e),
      ),
  });

  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/dashboard" replace />;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const p = passwordSchema.safeParse(next);
    if (!p.success) return setError(p.error.issues[0]!.message);
    m.mutate();
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="grid gap-4 rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <div className="grid gap-1">
            <h1 className="font-display text-xl font-bold">Defina uma nova senha</h1>
            <p className="text-sm text-muted-foreground">
              Sua senha foi redefinida pelo suporte. Crie uma nova senha para continuar.
            </p>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            <Field id="cp-current" label="Senha atual (ou temporária)">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              )}
            </Field>
            <Field id="cp-new" label="Nova senha" hint="Mínimo de 10 caracteres.">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              )}
            </Field>
            {error && <Alert variant="danger">{error}</Alert>}
            <Button type="submit" size="lg" className="w-full" loading={m.isPending}>
              Salvar e continuar
            </Button>
          </form>
          <button
            type="button"
            className="justify-self-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => logout()}
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
