import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { signupSchema, type MeResponse } from '@azhoot/contracts';
import { Alert, Button, Field, Input, Logo } from '@azhoot/ui';
import { api, ApiError, describeError, setCsrfToken } from '@/lib/api';
import { ME_KEY, useAuth } from '@/lib/auth';

const REF_KEY = 'azhoot:ref';

/** Guarda o código de indicação por 30 dias (o visitante pode navegar antes de se cadastrar). */
export function rememberRef(ref: string | null) {
  try {
    if (ref) localStorage.setItem(REF_KEY, JSON.stringify({ ref, at: Date.now() }));
    const raw = localStorage.getItem(REF_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { ref: string; at: number };
    return Date.now() - v.at < 30 * 86400_000 ? v.ref : null;
  } catch {
    return ref;
  }
}

export function SignupPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [ref] = useState(() => rememberRef(params.get('ref')));
  const [form, setForm] = useState({
    name: '',
    accountName: '',
    email: '',
    password: '',
    acceptTerms: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const wantsPaid = ['MONTHLY', 'YEARLY'].includes(params.get('plano') ?? '');
  if (user) return <Navigate to={wantsPaid ? '/planos' : '/dashboard'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = signupSchema.safeParse({
      ...form,
      accountName: form.accountName || undefined,
      ref: ref ?? undefined,
    });
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[String(i.path[0])] ??= i.message;
      return setErrors(f);
    }
    setErrors({});
    setLoading(true);
    try {
      const res = await api<MeResponse>('/auth/signup', { body: parsed.data });
      setCsrfToken(res.csrfToken);
      qc.setQueryData(ME_KEY, res);
      localStorage.removeItem(REF_KEY);
      // Veio de "Assinar" na landing: segue direto para a contratação.
      navigate(wantsPaid ? '/planos' : '/dashboard', { replace: true });
    } catch (err) {
      setErrors(
        err instanceof ApiError && err.code === 'EMAIL_IN_USE'
          ? { email: err.message }
          : { _: describeError(err) },
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="bg-waves hidden flex-col justify-between p-12 text-white lg:flex">
        <Logo inverted />
        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight">
            Comece grátis. Engaje seu público hoje.
          </h1>
          <ul className="mt-6 grid gap-3 text-lg text-slate-200">
            {[
              '5 quizzes no plano Gratuito',
              'Salas com PIN e QR Code',
              'Pontuação e ranking ao vivo',
              'Faça upgrade quando quiser',
            ].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <Check className="size-5 text-green-400" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-slate-400">Sem cartão de crédito para começar.</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12">
        <form
          onSubmit={submit}
          noValidate
          className="w-full max-w-sm space-y-4"
          aria-labelledby="signup-title"
        >
          <div className="lg:hidden">
            <Logo />
          </div>
          <div>
            <h2 id="signup-title" className="text-2xl font-bold">
              Criar conta grátis
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Você começa no plano Gratuito.</p>
          </div>
          {ref && <Alert variant="success">Você foi indicado por um amigo. Bem-vindo!</Alert>}
          {errors._ && <Alert variant="danger">{errors._}</Alert>}
          <Field id="su-name" label="Seu nome" error={errors.name}>
            {(p) => (
              <Input
                {...p}
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            )}
          </Field>
          <Field id="su-account" label="Empresa ou escola (opcional)">
            {(p) => (
              <Input
                {...p}
                autoComplete="organization"
                value={form.accountName}
                onChange={(e) => setForm({ ...form, accountName: e.target.value })}
              />
            )}
          </Field>
          <Field id="su-email" label="E-mail" error={errors.email}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            )}
          </Field>
          <Field
            id="su-password"
            label="Senha"
            error={errors.password}
            hint="Mínimo de 10 caracteres."
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            )}
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-blue-600"
              checked={form.acceptTerms}
              onChange={(e) => setForm({ ...form, acceptTerms: e.target.checked })}
            />
            <span>Aceito os termos de uso e a política de privacidade.</span>
          </label>
          {errors.acceptTerms && (
            <p className="text-xs font-medium text-danger" role="alert">
              {errors.acceptTerms}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Criar minha conta
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Já tem conta?{' '}
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Entrar
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
