import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, RotateCcw, Send, XCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_TEMPLATES,
  NOTIFICATION_LABELS,
  NOTIFICATION_TYPES,
  type NotificationTemplate,
  type NotificationType,
  type PlanDto,
} from '@azhoot/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { PlatformCard } from '@/pages/admin/SettingsPage';
import { api, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { moneyInput, parseMoney } from './shared';

const TABS = [
  { id: 'email', label: 'E-mail' },
  { id: 'asaas', label: 'Integração Asaas' },
  { id: 'planos', label: 'Planos' },
  { id: 'afiliado', label: 'Afiliado' },
  { id: 'ia', label: 'IA' },
  { id: 'pacotes', label: 'Créditos' },
  { id: 'plataforma', label: 'Plataforma' },
  { id: 'envios', label: 'Log de envios' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default function MasterSettings() {
  const [tab, setTab] = useState<Tab>('email');
  return (
    <>
      <PageHeader
        title="Configurações"
        description="Integrações, mensagens, planos e regras globais da plataforma."
      />
      <div
        role="tablist"
        aria-label="Seções de configuração"
        className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors sm:flex-1',
              tab === t.id
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'email' && <EmailTab />}
        {tab === 'asaas' && <AsaasTab />}
        {tab === 'planos' && <PlansTab />}
        {tab === 'afiliado' && <AffiliateTab />}
        {tab === 'ia' && <AiTab />}
        {tab === 'pacotes' && <CreditPacksTab />}
        {tab === 'plataforma' && <PlatformCard />}
        {tab === 'envios' && <DeliveriesTab />}
      </div>
    </>
  );
}

/* ---------------------------------- E-mail -------------------------------- */

interface EmailSettings {
  provider: 'sendgrid' | 'log';
  apiKeyMasked: string | null;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  templates: Record<NotificationType, NotificationTemplate>;
}

const VARS = [
  '{{nome}}',
  '{{conta}}',
  '{{plano}}',
  '{{plano_anterior}}',
  '{{valor}}',
  '{{vencimento}}',
  '{{link}}',
  '{{relatorio}}',
];

function EmailTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['master', 'settings', 'email'],
    queryFn: () => api<EmailSettings>('/master/settings/email'),
  });
  const [form, setForm] = useState<Omit<EmailSettings, 'apiKeyMasked'> & { apiKey: string }>();
  const [selected, setSelected] = useState<NotificationType>('welcome');
  const [testTo, setTestTo] = useState(user?.email ?? '');
  useEffect(() => {
    if (q.data) setForm({ ...q.data, apiKey: '' });
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const { apiKey, ...rest } = form!;
      return api<EmailSettings>('/master/settings/email', {
        method: 'PUT',
        body: { ...rest, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) },
      });
    },
    onSuccess: (d) => {
      qc.setQueryData(['master', 'settings', 'email'], d);
      toast.success('Configurações de e-mail salvas.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const test = useMutation({
    mutationFn: (type?: NotificationType) =>
      api<{ ok: boolean; error?: string; result?: unknown }>('/master/settings/email/test', {
        body: { to: testTo, type },
      }),
    onSuccess: (r) =>
      r.ok
        ? toast.success(`Teste enviado para ${testTo}.`)
        : toast.error(`Falha no envio: ${r.error}`),
    onError: (e) => toast.error(describeError(e)),
  });

  if (q.isPending || !form) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  const tpl = form.templates[selected];
  const setTpl = (patch: Partial<NotificationTemplate>) =>
    setForm({ ...form, templates: { ...form.templates, [selected]: { ...tpl, ...patch } } });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[380px_1fr] [&>*]:min-w-0">
      <Card className="content-start">
        <CardHeader>
          <CardTitle>Envio (SendGrid)</CardTitle>
          <CardDescription>
            Use a API Mail Send do SendGrid. No modo “Somente registrar”, os e-mails são gravados no
            log sem envio real.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field id="em-prov" label="Provedor">
            {(p) => (
              <Select
                {...p}
                value={form.provider}
                onChange={(e) =>
                  setForm({ ...form, provider: e.target.value as EmailSettings['provider'] })
                }
              >
                <option value="sendgrid">SendGrid</option>
                <option value="log">Somente registrar (sem envio)</option>
              </Select>
            )}
          </Field>
          <Field
            id="em-key"
            label="Chave de API do SendGrid"
            hint={
              q.data.apiKeyMasked
                ? `Atual: ${q.data.apiKeyMasked}. Deixe em branco para manter.`
                : 'Começa com “SG.”'
            }
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="SG.xxxxx"
              />
            )}
          </Field>
          <Field
            id="em-from"
            label="E-mail remetente"
            hint="Precisa estar verificado no SendGrid (Sender Authentication)."
          >
            {(p) => (
              <Input
                {...p}
                type="email"
                value={form.fromEmail}
                onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                placeholder="nao-responda@seudominio.com.br"
              />
            )}
          </Field>
          <Field id="em-name" label="Nome do remetente">
            {(p) => (
              <Input
                {...p}
                value={form.fromName}
                onChange={(e) => setForm({ ...form, fromName: e.target.value })}
              />
            )}
          </Field>
          <Field id="em-reply" label="Responder para (opcional)">
            {(p) => (
              <Input
                {...p}
                type="email"
                value={form.replyTo}
                onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
              />
            )}
          </Field>
          <hr className="border-border" />
          <Field id="em-test" label="Enviar teste para">
            {(p) => (
              <Input
                {...p}
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
            )}
          </Field>
          <Button
            type="button"
            variant="outline"
            loading={test.isPending && !test.variables}
            disabled={!testTo}
            onClick={() => test.mutate(undefined)}
          >
            <Send className="size-4" aria-hidden /> Testar configuração
          </Button>
          <p className="text-xs text-muted-foreground">
            Salve antes de testar para usar os dados novos.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mensagens</CardTitle>
          <CardDescription>
            Cada notificação é enviada por e-mail e aparece no sininho do painel. Personalize
            assunto e texto.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[220px_1fr]">
          <ul className="grid content-start gap-1" aria-label="Notificações">
            {NOTIFICATION_TYPES.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  aria-current={selected === t}
                  onClick={() => setSelected(t)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm',
                    selected === t
                      ? 'bg-primary/10 font-semibold text-primary-strong dark:text-blue-300'
                      : 'hover:bg-muted',
                  )}
                >
                  {NOTIFICATION_LABELS[t]}
                  {!form.templates[t].enabled && <Badge variant="muted">Off</Badge>}
                </button>
              </li>
            ))}
          </ul>
          <div className="grid content-start gap-3">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm font-medium">
              {tpl.enabled ? 'Envio ativo' : 'Envio desativado'}
              <Switch
                checked={tpl.enabled}
                onCheckedChange={(v) => setTpl({ enabled: v })}
                aria-label={`Ativar ${NOTIFICATION_LABELS[selected]}`}
              />
            </label>
            <Field id="tpl-subject" label="Assunto">
              {(p) => (
                <Input
                  {...p}
                  value={tpl.subject}
                  onChange={(e) => setTpl({ subject: e.target.value })}
                  maxLength={200}
                />
              )}
            </Field>
            <Field id="tpl-body" label="Mensagem">
              {(p) => (
                <Textarea
                  {...p}
                  rows={12}
                  value={tpl.body}
                  onChange={(e) => setTpl({ body: e.target.value })}
                  className="font-mono text-xs"
                />
              )}
            </Field>
            <p className="text-xs text-muted-foreground">
              Variáveis:{' '}
              {VARS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="mr-1 rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-primary/10"
                  onClick={() => setTpl({ body: `${tpl.body}${v}` })}
                >
                  {v}
                </button>
              ))}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTpl(DEFAULT_TEMPLATES[selected])}
              >
                <RotateCcw className="size-4" aria-hidden /> Restaurar padrão
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!testTo}
                loading={test.isPending && test.variables === selected}
                onClick={() => test.mutate(selected)}
              >
                <Send className="size-4" aria-hidden /> Enviar exemplo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        <Button type="submit" loading={save.isPending}>
          Salvar e-mail e mensagens
        </Button>
      </div>
    </form>
  );
}

/* ---------------------------------- Asaas --------------------------------- */

interface AsaasSettings {
  environment: 'sandbox' | 'production';
  apiKeyMasked: string | null;
  webhookTokenMasked: string | null;
  configured: boolean;
  webhookUrl: string;
}

function randomToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function AsaasTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['master', 'settings', 'asaas'],
    queryFn: () => api<AsaasSettings>('/master/settings/asaas'),
  });
  const [env, setEnv] = useState<AsaasSettings['environment']>('sandbox');
  const [apiKey, setApiKey] = useState('');
  const [token, setToken] = useState('');
  useEffect(() => {
    if (q.data) setEnv(q.data.environment);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api<AsaasSettings>('/master/settings/asaas', {
        method: 'PUT',
        body: {
          environment: env,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(token.trim() ? { webhookToken: token.trim() } : {}),
        },
      }),
    onSuccess: (d) => {
      qc.setQueryData(['master', 'settings', 'asaas'], d);
      setApiKey('');
      setToken('');
      toast.success('Integração Asaas salva.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; error?: string }>('/master/settings/asaas/test', { method: 'POST' }),
    onSuccess: (r) =>
      r.ok ? toast.success('Conexão com o Asaas OK.') : toast.error(`Falha: ${r.error}`),
    onError: (e) => toast.error(describeError(e)),
  });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  const d = q.data;

  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Asaas{' '}
            {d.configured ? (
              <Badge variant="success">Configurado</Badge>
            ) : (
              <Badge variant="warning">Não configurado</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Cobranças por PIX, boleto e cartão (o cliente escolhe na fatura). Sem chave configurada,
            o ambiente de desenvolvimento usa o pagamento simulado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim() && token.trim().length < 16)
                return toast.error('O token do webhook precisa ter ao menos 16 caracteres.');
              save.mutate();
            }}
          >
            <Field id="as-env" label="Ambiente">
              {(p) => (
                <Select
                  {...p}
                  value={env}
                  onChange={(e) => setEnv(e.target.value as AsaasSettings['environment'])}
                >
                  <option value="sandbox">Sandbox (testes)</option>
                  <option value="production">Produção</option>
                </Select>
              )}
            </Field>
            <Field
              id="as-key"
              label="Chave de API"
              hint={
                d.apiKeyMasked
                  ? `Atual: ${d.apiKeyMasked}. Deixe em branco para manter.`
                  : 'Asaas → Integrações → Chave de API.'
              }
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="$aact_..."
                />
              )}
            </Field>
            <Field
              id="as-token"
              label="Token de autenticação do webhook"
              hint={
                d.webhookTokenMasked
                  ? `Atual: ${d.webhookTokenMasked}.`
                  : 'Mesmo valor informado no webhook do Asaas.'
              }
            >
              {(p) => (
                <div className="flex gap-2">
                  <Input
                    {...p}
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <Button type="button" variant="outline" onClick={() => setToken(randomToken())}>
                    Gerar
                  </Button>
                </div>
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={save.isPending}>
                Salvar
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={test.isPending}
                onClick={() => test.mutate()}
                disabled={!d.configured}
              >
                Testar conexão
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Configurar o webhook no Asaas</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <ol className="grid list-decimal gap-2 pl-5">
            <li>No Asaas, abra Integrações → Webhooks → Adicionar.</li>
            <li>
              URL:
              <div className="mt-1 flex items-center gap-2 rounded-lg bg-muted p-2 font-mono text-xs">
                <span className="flex-1 break-all">{d.webhookUrl}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Copiar URL"
                  onClick={() => {
                    void navigator.clipboard.writeText(d.webhookUrl);
                    toast.success('URL copiada!');
                  }}
                >
                  <Copy className="size-4" aria-hidden />
                </Button>
              </div>
            </li>
            <li>Token de autenticação: o mesmo salvo ao lado.</li>
            <li>Versão da API: v3 · Tipo de envio: sequencial.</li>
            <li>Eventos: todos de Cobranças (PAYMENT_*).</li>
          </ol>
          <Alert variant="info">
            Pagamentos confirmados liberam upgrades na hora, renovam o período e descongelam contas
            automaticamente.
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------- Planos -------------------------------- */

function PlansTab() {
  const q = useQuery({
    queryKey: ['master', 'plans'],
    queryFn: () => api<{ items: PlanDto[] }>('/master/plans'),
  });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  return (
    <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
      {q.data.items.map((p) => (
        <PlanEditor key={p.id} plan={p} />
      ))}
      <p className="text-xs text-muted-foreground lg:col-span-3">
        Mudanças valem para todas as contas do plano (exceto as com limites personalizados). Novos
        preços valem para novas assinaturas; para ajustar clientes existentes use o preço especial
        na conta.
      </p>
    </div>
  );
}

function PlanEditor({ plan }: { plan: PlanDto }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: plan.name,
    description: plan.description ?? '',
    price: moneyInput(plan.priceCents),
    maxQuizzes: plan.maxQuizzes?.toString() ?? '',
    maxParticipants: String(plan.maxParticipants),
    maxUsers: String(plan.maxUsers),
    features: plan.features.join('\n'),
    aiCreditsIncluded: String(plan.aiCreditsIncluded),
    active: plan.active,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<PlanDto>(`/master/plans/${plan.id}`, { method: 'PUT', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['master', 'plans'] });
      void qc.invalidateQueries({ queryKey: ['account', 'billing'] });
      toast.success(`Plano ${f.name} salvo.`);
    },
    onError: (e) => setError(describeError(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const priceCents = plan.id === 'FREE' ? 0 : parseMoney(f.price);
    const maxQuizzes = f.maxQuizzes.trim() ? Number(f.maxQuizzes) : null;
    const maxParticipants = Number(f.maxParticipants);
    const maxUsers = Number(f.maxUsers);
    if (priceCents == null) return setError('Preço inválido.');
    if (maxQuizzes != null && (!Number.isInteger(maxQuizzes) || maxQuizzes < 0))
      return setError('Quizzes: número inteiro ou em branco (ilimitado).');
    if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 200)
      return setError('Participantes: entre 2 e 200.');
    if (!Number.isInteger(maxUsers) || maxUsers < 1) return setError('Usuários: mínimo 1.');
    setError(null);
    save.mutate({
      name: f.name.trim(),
      description: f.description.trim() || null,
      priceCents,
      maxQuizzes,
      maxParticipants,
      maxUsers,
      features: f.features
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      aiCreditsIncluded: Number(f.aiCreditsIncluded) || 0,
      active: f.active,
    });
  }
  const interval = plan.interval === 'YEARLY' ? '/ano' : plan.interval === 'MONTHLY' ? '/mês' : '';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          {plan.name}
          <Badge variant="muted">{plan.id}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={submit} noValidate>
          <Field id={`pl-${plan.id}-name`} label="Nome">
            {(p) => (
              <Input
                {...p}
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                maxLength={60}
              />
            )}
          </Field>
          <Field id={`pl-${plan.id}-desc`} label="Descrição">
            {(p) => (
              <Input
                {...p}
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
                maxLength={300}
              />
            )}
          </Field>
          <Field id={`pl-${plan.id}-price`} label={`Preço (R$${interval})`}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={plan.id === 'FREE' ? '0,00' : f.price}
                disabled={plan.id === 'FREE'}
                onChange={(e) => setF({ ...f, price: e.target.value })}
              />
            )}
          </Field>
          <div className="grid grid-cols-3 items-start gap-2">
            <Field id={`pl-${plan.id}-q`} label="Quizzes" hint="Vazio = ∞">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={f.maxQuizzes}
                  onChange={(e) => setF({ ...f, maxQuizzes: e.target.value })}
                />
              )}
            </Field>
            <Field id={`pl-${plan.id}-p`} label="Pessoas">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={f.maxParticipants}
                  onChange={(e) => setF({ ...f, maxParticipants: e.target.value })}
                />
              )}
            </Field>
            <Field id={`pl-${plan.id}-u`} label="Usuários">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={f.maxUsers}
                  onChange={(e) => setF({ ...f, maxUsers: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field
            id={`pl-${plan.id}-ai`}
            label="Créditos de IA grátis"
            hint="Concedidos uma vez ao contratar o plano"
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={f.aiCreditsIncluded}
                onChange={(e) => setF({ ...f, aiCreditsIncluded: e.target.value })}
              />
            )}
          </Field>
          <Field id={`pl-${plan.id}-f`} label="Benefícios (um por linha)">
            {(p) => (
              <Textarea
                {...p}
                rows={5}
                value={f.features}
                onChange={(e) => setF({ ...f, features: e.target.value })}
              />
            )}
          </Field>
          {plan.id !== 'FREE' && (
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={f.active}
                onCheckedChange={(v) => setF({ ...f, active: v })}
                aria-label="Plano disponível para contratação"
              />{' '}
              Disponível para contratação
            </label>
          )}
          {error && <Alert variant="danger">{error}</Alert>}
          <Button type="submit" loading={save.isPending}>
            Salvar plano
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* --------------------------------- Afiliado ------------------------------- */

function AffiliateTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['master', 'settings', 'affiliate'],
    queryFn: () => api<{ percentBp: number; recurring: boolean }>('/master/settings/affiliate'),
  });
  const [percent, setPercent] = useState('');
  const [recurring, setRecurring] = useState(true);
  useEffect(() => {
    if (q.data) {
      setPercent(String(q.data.percentBp / 100).replace('.', ','));
      setRecurring(q.data.recurring);
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: { percentBp: number; recurring: boolean }) =>
      api('/master/settings/affiliate', { method: 'PUT', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['master', 'settings', 'affiliate'] });
      toast.success('Regras de afiliado salvas.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Programa de afiliados</CardTitle>
        <CardDescription>
          Percentual global aplicado a quem não tem percentual próprio definido na conta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(percent.replace(',', '.'));
            if (!Number.isFinite(v) || v < 0 || v > 100)
              return toast.error('Percentual entre 0 e 100.');
            save.mutate({ percentBp: Math.round(v * 100), recurring });
          }}
        >
          <Field
            id="aff-global"
            label="Percentual global (%)"
            hint="Ex.: 20 = o afiliado recebe 20% de cada pagamento do indicado."
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
            )}
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <Switch
              checked={recurring}
              onCheckedChange={setRecurring}
              aria-label="Comissão recorrente"
            />
            <span>
              <span className="font-medium">Comissão recorrente</span>
              <span className="block text-xs text-muted-foreground">
                Ligado: comissão em todas as mensalidades/anuidades pagas pelo indicado. Desligado:
                só no primeiro pagamento.
              </span>
            </span>
          </label>
          <Button type="submit" loading={save.isPending} className="justify-self-start">
            Salvar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------- Log de envios ---------------------------- */

interface Delivery {
  id: string;
  accountId: string | null;
  type: string;
  refKey: string;
  toEmail: string;
  channel: string;
  status: string;
  error: string | null;
  createdAt: string;
}

function DeliveriesTab() {
  const [type, setType] = useState('ALL');
  const q = useQuery({
    queryKey: ['master', 'deliveries'],
    queryFn: () => api<{ items: Delivery[] }>('/master/notifications/deliveries'),
  });
  const run = useMutation({
    mutationFn: () => api<Record<string, unknown>>('/master/jobs/billing', { method: 'POST' }),
    onSuccess: () => {
      void q.refetch();
      toast.success('Rotina de cobrança executada.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  const items = q.data.items.filter((d) => type === 'ALL' || d.type === type);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Últimos envios</CardTitle>
          <CardDescription>
            Cada notificação é enviada uma única vez por destinatário e referência.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Tipo"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-auto"
          >
            <option value="ALL">Todos os tipos</option>
            {NOTIFICATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {NOTIFICATION_LABELS[t]}
              </option>
            ))}
          </Select>
          <Button variant="outline" loading={run.isPending} onClick={() => run.mutate()}>
            Executar rotina agora
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum envio registrado.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {items.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0"
              >
                <span className="flex items-center gap-2">
                  {d.status === 'SENT' ? (
                    <CheckCircle2 className="size-4 text-success" aria-label="Enviado" />
                  ) : d.status === 'FAILED' ? (
                    <XCircle className="size-4 text-danger" aria-label="Falhou" />
                  ) : (
                    <span
                      className="size-4 rounded-full border border-border"
                      aria-label="Ignorado"
                    />
                  )}
                  <span>
                    <span className="font-medium">
                      {NOTIFICATION_LABELS[d.type as NotificationType] ?? d.type}
                    </span>
                    <span className="text-muted-foreground"> → {d.toEmail}</span>
                    {d.error && (
                      <span className="block text-xs text-red-700 dark:text-red-300">
                        {d.error}
                      </span>
                    )}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(d.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------ IA --------------------------------- */

interface AiSettings {
  provider: 'openai';
  model: string;
  apiKeyMasked: string | null;
  configured: boolean;
}

function AiTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['master', 'settings', 'ai'],
    queryFn: () => api<AiSettings>('/master/settings/ai'),
  });
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  useEffect(() => {
    if (q.data) setModel(q.data.model);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api<AiSettings>('/master/settings/ai', {
        method: 'PUT',
        body: { model, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) },
      }),
    onSuccess: (d) => {
      qc.setQueryData(['master', 'settings', 'ai'], d);
      setApiKey('');
      toast.success('Configuração de IA salva.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  const d = q.data;
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Geração com IA (OpenAI){' '}
          {d.configured ? (
            <Badge variant="success">Configurado</Badge>
          ) : (
            <Badge variant="warning">Não configurado</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Chave da API da OpenAI usada para gerar perguntas. Sem chave, em desenvolvimento, a
          geração usa um provedor simulado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field id="ai-model" label="Modelo" hint="Ex.: gpt-4o-mini, gpt-4.1-mini">
            {(p) => <Input {...p} value={model} onChange={(e) => setModel(e.target.value)} />}
          </Field>
          <Field
            id="ai-key"
            label="Chave da API"
            hint={
              d.apiKeyMasked
                ? `Atual: ${d.apiKeyMasked}. Deixe em branco para manter.`
                : 'Começa com "sk-".'
            }
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
            )}
          </Field>
          <Button type="submit" loading={save.isPending} className="justify-self-start">
            Salvar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Pacotes de crédito ----------------------- */

interface Pack {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  active: boolean;
  sortOrder: number;
}

function CreditPacksTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['master', 'credit-packs'],
    queryFn: () => api<{ items: Pack[] }>('/master/credit-packs'),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['master', 'credit-packs'] });
  const del = useMutation({
    mutationFn: (id: string) => api(`/master/credit-packs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Pacote excluído.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Pacotes de créditos de IA que os clientes podem comprar (pagamento avulso). Os créditos não
        expiram.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {q.data.items.map((p) => (
          <PackEditor
            key={p.id}
            pack={p}
            onChanged={invalidate}
            onDelete={() => del.mutate(p.id)}
          />
        ))}
        <PackEditor onChanged={invalidate} />
      </div>
    </div>
  );
}

function PackEditor({
  pack,
  onChanged,
  onDelete,
}: {
  pack?: Pack;
  onChanged: () => void;
  onDelete?: () => void;
}) {
  const isNew = !pack;
  const [f, setF] = useState({
    name: pack?.name ?? '',
    credits: pack ? String(pack.credits) : '',
    price: pack ? moneyInput(pack.priceCents) : '',
    sortOrder: pack ? String(pack.sortOrder) : '0',
    active: pack?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        credits: Number(f.credits),
        priceCents: parseMoney(f.price) ?? 0,
        sortOrder: Number(f.sortOrder) || 0,
        active: f.active,
      };
      return isNew
        ? api('/master/credit-packs', { body })
        : api(`/master/credit-packs/${pack!.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      onChanged();
      toast.success(isNew ? 'Pacote criado.' : 'Pacote salvo.');
      if (isNew) setF({ name: '', credits: '', price: '', sortOrder: '0', active: true });
    },
    onError: (e) => setError(describeError(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError('Informe um nome.');
    if (!Number.isInteger(Number(f.credits)) || Number(f.credits) < 1)
      return setError('Créditos inválidos.');
    if (parseMoney(f.price) == null) return setError('Preço inválido.');
    setError(null);
    save.mutate();
  }
  return (
    <Card className={cn(isNew && 'border-dashed')}>
      <CardHeader>
        <CardTitle className="text-base">{isNew ? 'Novo pacote' : pack!.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={submit} noValidate>
          <Field id={`pk-${pack?.id ?? 'new'}-name`} label="Nome">
            {(p) => (
              <Input
                {...p}
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                maxLength={60}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field id={`pk-${pack?.id ?? 'new'}-credits`} label="Créditos">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={f.credits}
                  onChange={(e) => setF({ ...f, credits: e.target.value })}
                />
              )}
            </Field>
            <Field id={`pk-${pack?.id ?? 'new'}-price`} label="Preço (R$)">
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={f.price}
                  onChange={(e) => setF({ ...f, price: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 items-end gap-2">
            <Field id={`pk-${pack?.id ?? 'new'}-order`} label="Ordem">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={f.sortOrder}
                  onChange={(e) => setF({ ...f, sortOrder: e.target.value })}
                />
              )}
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Switch
                checked={f.active}
                onCheckedChange={(v) => setF({ ...f, active: v })}
                aria-label="Ativo"
              />{' '}
              Ativo
            </label>
          </div>
          {error && <Alert variant="danger">{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              {isNew ? 'Criar' : 'Salvar'}
            </Button>
            {!isNew && onDelete && (
              <Button type="button" size="sm" variant="ghost" onClick={onDelete}>
                Excluir
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
