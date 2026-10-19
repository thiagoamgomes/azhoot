import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginSchema } from '@azhoot/contracts';
import { Alert, Button, Field, Input, Logo } from '@azhoot/ui';
import { ApiError, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  if (user) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[String(i.path[0])] ??= i.message;
      setErrors(f);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
          ? 'E-mail ou senha incorretos.'
          : describeError(err),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="bg-waves relative hidden flex-col justify-between p-12 text-white lg:flex">
        <Logo inverted />
        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight">
            Interação do começo ao fim, de A a Z.
          </h1>
          <p className="mt-4 text-lg text-slate-300">
            Crie quizzes, abra uma sala e acompanhe as respostas do público em tempo real.
          </p>
        </div>
        <p className="text-sm text-slate-400">AZhoot · pronuncia-se “Azute”</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12">
        <form
          onSubmit={onSubmit}
          noValidate
          className="w-full max-w-sm space-y-5"
          aria-labelledby="login-title"
        >
          <div className="lg:hidden">
            <Logo />
          </div>
          <div>
            <h2 id="login-title" className="text-2xl font-bold">
              Entrar no painel
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Acesso restrito a administradores.</p>
          </div>
          {formError && <Alert variant="danger">{formError}</Alert>}
          <Field id="email" label="E-mail" error={errors.email}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Field id="password" label="Senha" error={errors.password}>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Entrar
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Ainda não tem conta?{' '}
            <a className="font-semibold text-primary hover:underline" href="/cadastro">
              Criar conta grátis
            </a>
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Vai participar de um quiz?{' '}
            <a className="font-semibold text-primary hover:underline" href="/entrar">
              Entre com o PIN
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
