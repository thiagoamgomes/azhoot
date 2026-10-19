import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, ShieldCheck, Trash2, TriangleAlert, UserCog } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { passwordSchema, userCreateSchema, type AppSettings } from '@azhoot/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Input,
  Label,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, ApiError, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useReducedMotion } from '@/lib/theme';
import type { AdminUser } from '@/lib/types';

const ROLE_LABEL = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  PRESENTER: 'Apresentador',
} as const;

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api('/auth/password', { body: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      toast.success('Senha alterada. Outras sessões foram encerradas.');
      setCurrent('');
      setNext('');
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === 'INVALID_CREDENTIALS'
          ? 'Senha atual incorreta.'
          : describeError(e),
      ),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const p = passwordSchema.safeParse(next);
    if (!p.success) return setError(p.error.issues[0]!.message);
    m.mutate();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-primary" aria-hidden /> Minha senha
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
          {error && <Alert variant="danger">{error}</Alert>}
          <Field id="pw-current" label="Senha atual">
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
          <Field id="pw-new" label="Nova senha" hint="Mínimo de 10 caracteres.">
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
          <Button
            type="submit"
            className="w-fit"
            loading={m.isPending}
            disabled={!current || !next}
          >
            Alterar senha
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PreferencesCard() {
  const [reduced, setReduced] = useReducedMotion();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferências deste navegador</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="pref-motion">Reduzir movimento</Label>
            <p className="text-xs text-muted-foreground">Desativa animações e celebrações.</p>
          </div>
          <Switch id="pref-motion" checked={reduced} onCheckedChange={setReduced} />
        </div>
      </CardContent>
    </Card>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'ADMIN' as 'ADMIN' | 'PRESENTER',
    canViewAllReports: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api<AdminUser>('/users', { body: form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário criado.');
      onOpenChange(false);
      setForm({ name: '', email: '', password: '', role: 'ADMIN', canViewAllReports: false });
    },
    onError: (e) =>
      setErrors(
        e instanceof ApiError && e.code === 'EMAIL_IN_USE'
          ? { email: e.message }
          : { _: describeError(e) },
      ),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const p = userCreateSchema.safeParse(form);
    if (!p.success) {
      const f: Record<string, string> = {};
      for (const i of p.error.issues) f[String(i.path[0])] ??= i.message;
      return setErrors(f);
    }
    setErrors({});
    m.mutate();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Novo usuário</DialogTitle>
          </DialogHeader>
          {errors._ && <Alert variant="danger">{errors._}</Alert>}
          <Field id="u-name" label="Nome" error={errors.name}>
            {(p) => (
              <Input
                {...p}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            )}
          </Field>
          <Field id="u-email" label="E-mail" error={errors.email}>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            )}
          </Field>
          <Field
            id="u-password"
            label="Senha inicial"
            error={errors.password}
            hint="Mínimo de 10 caracteres. Oriente o usuário a trocá-la."
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
          <Field
            id="u-role"
            label="Perfil"
            hint="Administrador cria e edita quizzes. Apresentador apenas apresenta quizzes publicados."
          >
            {(p) => (
              <Select
                {...p}
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as 'ADMIN' | 'PRESENTER' })
                }
              >
                <option value="ADMIN">Administrador</option>
                <option value="PRESENTER">Apresentador</option>
              </Select>
            )}
          </Field>
          <div className="flex items-center justify-between">
            <Label htmlFor="u-all">Pode consultar relatórios de todos</Label>
            <Switch
              id="u-all"
              checked={form.canViewAllReports}
              onCheckedChange={(v) => setForm({ ...form, canViewAllReports: v })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={m.isPending}>
              Criar usuário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UsersCard() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [open, setOpen] = useState(false);
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ items: AdminUser[] }>('/users'),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api<AdminUser>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário atualizado.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="size-5 text-primary" aria-hidden /> Usuários administrativos
          </CardTitle>
          <CardDescription>
            Contas com acesso ao painel. Participantes não precisam de conta.
          </CardDescription>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus /> Novo usuário
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {users.isPending ? (
          <Skeleton className="h-32" />
        ) : users.isError ? (
          <ErrorState description={describeError(users.error)} />
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-3">
                  Nome
                </th>
                <th scope="col" className="py-2 pr-3">
                  Perfil
                </th>
                <th scope="col" className="py-2 pr-3">
                  Relatórios de todos
                </th>
                <th scope="col" className="py-2 pr-3">
                  Último acesso
                </th>
                <th scope="col" className="py-2">
                  Ativo
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.data.items.map((u) => {
                const locked = u.role === 'OWNER' || u.id === me?.id;
                return (
                  <tr key={u.id}>
                    <td className="py-2 pr-3">
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="py-2 pr-3">
                      {locked ? (
                        <Badge variant={u.role === 'OWNER' ? 'accent' : 'default'}>
                          {ROLE_LABEL[u.role]}
                        </Badge>
                      ) : (
                        <Select
                          aria-label={`Perfil de ${u.name}`}
                          className="min-h-9 w-40"
                          value={u.role}
                          onChange={(e) =>
                            patch.mutate({ id: u.id, body: { role: e.target.value } })
                          }
                        >
                          <option value="ADMIN">Administrador</option>
                          <option value="PRESENTER">Apresentador</option>
                        </Select>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Switch
                        aria-label={`${u.name} pode consultar relatórios de todos`}
                        disabled={locked}
                        checked={u.role === 'OWNER' || u.canViewAllReports}
                        onCheckedChange={(v) =>
                          patch.mutate({ id: u.id, body: { canViewAllReports: v } })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3 text-xs">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="py-2">
                      <Switch
                        aria-label={`${u.name} ativo`}
                        disabled={locked}
                        checked={u.active}
                        onCheckedChange={(v) => patch.mutate({ id: u.id, body: { active: v } })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
      <CreateUserDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

export function PlatformCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<AppSettings>('/settings') });
  const [blocklist, setBlocklist] = useState('');
  const [retention, setRetention] = useState(0);
  const [mode, setMode] = useState<AppSettings['deletionMode']>('ANONYMIZE');
  useEffect(() => {
    if (q.data) {
      setBlocklist(q.data.nicknameBlocklist.join('\n'));
      setRetention(q.data.retentionDays);
      setMode(q.data.deletionMode);
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api<AppSettings>('/settings', {
        method: 'PUT',
        body: {
          nicknameBlocklist: [
            ...new Set(
              blocklist
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter((s) => s.length >= 2),
            ),
          ],
          retentionDays: retention,
          deletionMode: mode,
        },
      }),
    onSuccess: (d) => {
      qc.setQueryData(['settings'], d);
      toast.success('Configurações salvas.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" aria-hidden /> Moderação e privacidade
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <Field
          id="blocklist"
          label="Termos bloqueados em apelidos"
          hint="Um termo por linha. A comparação ignora acentos, maiúsculas e separadores."
        >
          {(p) => (
            <Textarea
              {...p}
              rows={5}
              value={blocklist}
              onChange={(e) => setBlocklist(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="retention"
            label="Retenção de relatórios (dias)"
            hint="0 = manter enquanto forem úteis."
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={3650}
                value={retention}
                onChange={(e) => setRetention(Math.max(0, Number(e.target.value) || 0))}
              />
            )}
          </Field>
          <Field id="del-mode" label="Ao excluir ou expirar">
            {(p) => (
              <Select
                {...p}
                value={mode}
                onChange={(e) => setMode(e.target.value as AppSettings['deletionMode'])}
              >
                <option value="ANONYMIZE">Anonimizar participantes</option>
                <option value="DELETE">Excluir sessão e respostas</option>
              </Select>
            )}
          </Field>
        </div>
        <Alert variant="info">
          <strong>Política de retenção:</strong> os relatórios são mantidos enquanto forem úteis
          {retention > 0 ? `, por até ${retention} dia(s) após o encerramento da sessão` : ''}. Na
          exclusão,
          {mode === 'ANONYMIZE'
            ? ' os apelidos são substituídos e as estatísticas preservadas.'
            : ' a sessão, participantes e respostas são removidos.'}{' '}
          Resultados individuais são privados; a tela coletiva mostra apenas apelido e pontuação.
        </Alert>
        <Button className="w-fit" loading={save.isPending} onClick={() => save.mutate()}>
          Salvar configurações
        </Button>
      </CardContent>
    </Card>
  );
}

interface DeletionSummary {
  quizzes: number;
  sessions: number;
  users: number;
  participants: number;
  planId: string;
  currentPeriodEnd: string | null;
}

/** Zona de perigo: checkbox libera o botão → modal com o que será perdido → senha. */
function DeleteAccountCard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const summary = useQuery({
    queryKey: ['deletion-summary'],
    queryFn: () => api<DeletionSummary>('/account/deletion-summary'),
    enabled: open,
  });
  const del = useMutation({
    mutationFn: () => api('/account', { method: 'DELETE', body: { password, confirm: true } }),
    onSuccess: async () => {
      setOpen(false);
      await logout().catch(() => undefined);
      toast.success('Sua conta foi excluída. Sentiremos sua falta.');
      navigate('/login', { replace: true });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === 'INVALID_CREDENTIALS'
          ? 'Senha incorreta.'
          : describeError(e),
      ),
  });
  return (
    <Card className="border-danger/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-danger">
          <TriangleAlert className="size-5" aria-hidden /> Excluir conta
        </CardTitle>
        <CardDescription>
          Remove definitivamente a conta, todos os quizzes, sessões, relatórios e usuários.
          Assinaturas pagas são canceladas. Esta ação não pode ser desfeita.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-red-600"
            checked={armed}
            onChange={(e) => setArmed(e.target.checked)}
          />
          <span>Entendo que todos os dados da conta serão apagados permanentemente.</span>
        </label>
        <Button
          variant="destructive"
          className="w-fit"
          disabled={!armed}
          onClick={() => setOpen(true)}
        >
          <Trash2 /> Excluir minha conta
        </Button>
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setPassword('');
            setError(null);
          }
        }}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!password) return setError('Informe sua senha.');
              setError(null);
              del.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Excluir a conta para sempre?</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
              <p className="font-semibold">Você vai perder:</p>
              {summary.isPending ? (
                <Skeleton className="h-16" />
              ) : summary.data ? (
                <ul className="grid gap-1">
                  <li>• {summary.data.quizzes} quiz(zes) criados</li>
                  <li>• {summary.data.sessions} sessão(ões) e todos os relatórios</li>
                  <li>• Os resultados de {summary.data.participants} participante(s)</li>
                  <li>• O acesso de {summary.data.users} usuário(s) da conta</li>
                  {summary.data.planId !== 'FREE' && (
                    <li>• O restante do seu plano pago, sem reembolso proporcional</li>
                  )}
                </ul>
              ) : null}
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
            <Field id="del-password" label="Digite sua senha para confirmar">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              )}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Manter minha conta
              </Button>
              <Button type="submit" variant="destructive" loading={del.isPending}>
                Excluir definitivamente
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function SettingsPage() {
  const { can, user } = useAuth();
  return (
    <>
      <PageHeader title="Configurações" description="Conta, usuários e preferências." />
      <div className="grid gap-6">
        <PasswordCard />
        <PreferencesCard />
        {can('manageUsers') && <UsersCard />}
        {user?.role === 'OWNER' && !user.isMaster && <DeleteAccountCard />}
      </div>
    </>
  );
}
