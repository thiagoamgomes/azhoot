import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  Check,
  Crown,
  FileSpreadsheet,
  KeyRound,
  ListChecks,
  Lock,
  Menu,
  PencilRuler,
  QrCode,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatBRL, type PlanDto } from '@azhoot/contracts';
import { Button, cn, Logo } from '@azhoot/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { rememberRef } from './SignupPage';

/** Planos padrão (usados só se a API estiver indisponível). Os reais vêm do painel master. */
const FALLBACK_PLANS: PlanDto[] = [
  {
    id: 'FREE',
    name: 'Gratuito',
    description: 'Para experimentar o AZhoot.',
    priceCents: 0,
    interval: 'NONE',
    maxQuizzes: 5,
    maxParticipants: 5,
    maxUsers: 1,
    features: [],
    aiCreditsIncluded: 3,
    active: true,
    sortOrder: 0,
  },
  {
    id: 'MONTHLY',
    name: 'Mensal',
    description: 'Para treinamentos e aulas frequentes.',
    priceCents: 990,
    interval: 'MONTHLY',
    maxQuizzes: 20,
    maxParticipants: 20,
    maxUsers: 3,
    features: [],
    aiCreditsIncluded: 20,
    active: true,
    sortOrder: 1,
  },
  {
    id: 'YEARLY',
    name: 'Anual',
    description: 'Para eventos e equipes.',
    priceCents: 9900,
    interval: 'YEARLY',
    maxQuizzes: null,
    maxParticipants: 200,
    maxUsers: 10,
    features: [],
    aiCreditsIncluded: 100,
    active: true,
    sortOrder: 2,
  },
];

const NAV = [
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#recursos', label: 'Recursos' },
  { href: '#planos', label: 'Planos' },
  { href: '#duvidas', label: 'Dúvidas' },
];

export default function LandingPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);

  // Link de afiliado pode apontar para a landing: guarda o código para o cadastro.
  useEffect(() => {
    const ref = params.get('ref');
    if (ref) rememberRef(ref);
  }, [params]);

  useEffect(() => {
    document.title = 'AZhoot — quizzes ao vivo para eventos, aulas e treinamentos';
  }, []);

  const signupHref = '/cadastro';

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-night"
      >
        Pular para o conteúdo
      </a>

      {/* ------------------------------- Cabeçalho ------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-night text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="AZhoot — início">
            <Logo inverted />
          </Link>
          <nav aria-label="Seções" className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"
              >
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/entrar"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white sm:inline-flex"
            >
              Tenho um PIN
            </Link>
            {user ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Ir para o painel</Link>
              </Button>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  Entrar
                </Link>
                <Button asChild size="sm" className="hidden sm:inline-flex">
                  <Link to={signupHref}>Criar conta grátis</Link>
                </Button>
              </>
            )}
            <button
              type="button"
              className="grid size-10 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white md:hidden"
              aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuOpen}
              aria-controls="menu-mobile"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? (
                <X className="size-5" aria-hidden />
              ) : (
                <Menu className="size-5" aria-hidden />
              )}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="menu-mobile"
            aria-label="Seções"
            className="grid gap-1 border-t border-white/10 px-4 py-3 md:hidden"
          >
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-3 text-base font-medium text-slate-200 hover:bg-white/10"
              >
                {n.label}
              </a>
            ))}
            <Link
              to="/entrar"
              className="rounded-lg px-3 py-3 text-base font-medium text-slate-200 hover:bg-white/10"
            >
              Tenho um PIN
            </Link>
            {!user && (
              <Button asChild className="mt-2">
                <Link to={signupHref}>Criar conta grátis</Link>
              </Button>
            )}
          </nav>
        )}
      </header>

      <main id="conteudo">
        {/* --------------------------------- Hero -------------------------------- */}
        <section
          aria-labelledby="hero-title"
          className="relative overflow-hidden bg-night text-white"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_80%_10%,rgba(37,99,235,0.35),transparent_70%),radial-gradient(40%_50%_at_0%_100%,rgba(124,58,237,0.22),transparent_70%)]"
          />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pb-28 lg:pt-20">
            <div className="grid gap-6">
              <p className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-200">
                <Sparkles className="size-3.5" aria-hidden /> Interação de A a Z
              </p>
              <h1
                id="hero-title"
                className="font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl xl:text-[3.5rem]"
              >
                Transforme qualquer apresentação em um{' '}
                <span className="text-blue-400">jogo ao vivo</span>.
              </h1>
              <p className="max-w-xl text-lg text-slate-300">
                Crie um quiz em minutos, projete na tela e deixe o público responder pelo celular
                com um PIN. Ranking, pódio e relatório completo no final.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link to={user ? '/dashboard' : signupHref}>
                    {user ? 'Ir para o painel' : 'Criar conta grátis'} <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/20 bg-white/5 text-white hover:bg-white/10"
                >
                  <Link to="/entrar">
                    <KeyRound aria-hidden /> Tenho um PIN
                  </Link>
                </Button>
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">
                {[
                  'Grátis para começar',
                  'Sem cartão de crédito',
                  'Participante não precisa de cadastro',
                ].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check className="size-4 text-green-400" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative mx-auto w-full max-w-2xl lg:max-w-none">
              <figure className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-blue-950/60">
                <div
                  className="flex items-center gap-1.5 border-b border-white/10 bg-white/5 px-3 py-2"
                  aria-hidden
                >
                  <span className="size-2.5 rounded-full bg-white/20" />
                  <span className="size-2.5 rounded-full bg-white/20" />
                  <span className="size-2.5 rounded-full bg-white/20" />
                  <span className="ml-3 text-[11px] text-slate-400">Tela projetada</span>
                </div>
                <img
                  src="/landing/apresentacao.webp"
                  width={1440}
                  height={900}
                  alt="Tela do apresentador exibindo a pergunta “Qual é a capital do Brasil?”, quatro alternativas coloridas, PIN da sala e cronômetro."
                  className="block w-full"
                  fetchPriority="high"
                />
              </figure>
              <figure className="absolute -bottom-10 -right-2 w-[34%] max-w-[210px] overflow-hidden rounded-[1.6rem] border-4 border-slate-800 bg-slate-900 shadow-2xl shadow-black/60 sm:-right-6">
                <img
                  src="/landing/celular.webp"
                  width={540}
                  height={1099}
                  alt="Celular do participante com as mesmas quatro alternativas em botões grandes."
                  className="block w-full"
                />
              </figure>
            </div>
          </div>
        </section>

        {/* ------------------------------ Casos de uso ----------------------------- */}
        <section aria-label="Onde usar" className="border-b border-border bg-surface">
          <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 text-sm font-semibold text-muted-foreground sm:px-6">
            {[
              'Eventos e palestras',
              'Treinamentos corporativos',
              'Aulas e escolas',
              'Reuniões e integrações',
              'Dinâmicas e festas',
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------ Como funciona ---------------------------- */}
        <Section id="como-funciona" eyebrow="Como funciona" title="Do quiz ao pódio em três passos">
          <ol className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: PencilRuler,
                title: 'Crie o quiz',
                text: 'Única escolha, múltipla escolha, verdadeiro ou falso e enquetes. Com imagem, tempo e pontuação por pergunta.',
              },
              {
                icon: QrCode,
                title: 'Abra a sala',
                text: 'Projete a tela e compartilhe o PIN de 6 dígitos ou o QR Code. O público entra só com um apelido.',
              },
              {
                icon: Trophy,
                title: 'Jogue ao vivo',
                text: 'Você controla o ritmo. Respostas, gráfico, classificação e pódio aparecem em tempo real.',
              },
            ].map((s, i) => (
              <li
                key={s.title}
                className="relative grid gap-3 rounded-2xl border border-border bg-surface p-6"
              >
                <span className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-primary text-white">
                    <s.icon className="size-5" aria-hidden />
                  </span>
                  <span className="font-display text-sm font-bold text-muted-foreground">
                    Passo {i + 1}
                  </span>
                </span>
                <h3 className="font-display text-xl font-semibold">{s.title}</h3>
                <p className="text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* -------------------------------- Recursos ------------------------------- */}
        <div id="recursos" className="scroll-mt-20 bg-muted/40">
          <Feature
            eyebrow="Editor"
            title="Monte perguntas no seu ritmo"
            text="Arraste para reordenar, adicione imagens e explicações, defina tempo e pontos. O rascunho é salvo sozinho e a publicação valida tudo antes de ir para o telão."
            bullets={[
              '4 tipos de pergunta',
              'Imagens otimizadas automaticamente',
              'Prévia antes de apresentar',
            ]}
            img={{
              src: '/landing/editor.webp',
              w: 1200,
              h: 1060,
              alt: 'Editor de quiz com a lista de perguntas à esquerda e as alternativas da pergunta selecionada à direita.',
            }}
          />
          <Feature
            reverse
            dark
            eyebrow="Ao vivo"
            title="A revelação que todo mundo espera"
            text="Mostre quantas pessoas escolheram cada alternativa, destaque a correta e explique o porquê. A pontuação premia quem acerta mais rápido — sempre calculada no servidor."
            bullets={[
              'Gráfico de respostas na hora',
              'Atalhos de teclado para o apresentador',
              'Reconexão automática se a internet oscilar',
            ]}
            img={{
              src: '/landing/revelacao.webp',
              w: 1200,
              h: 750,
              alt: 'Tela de revelação com a alternativa correta destacada e um gráfico de barras com a quantidade de respostas.',
            }}
          />
          <Feature
            eyebrow="Final"
            title="Pódio para celebrar, relatório para analisar"
            text="Encerre com pódio e classificação completa. Depois, veja taxa de acerto, tempo médio e as perguntas mais difíceis — e exporte tudo em CSV ou Excel."
            bullets={[
              'Pódio e ranking ao vivo',
              'Relatório por pergunta e por participante',
              'Exportação CSV e XLSX',
            ]}
            img={{
              src: '/landing/relatorio.webp',
              w: 1200,
              h: 908,
              alt: 'Relatório da sessão com participantes, taxa média de acerto, tempo médio e classificação final.',
            }}
          />
        </div>

        <Section
          eyebrow="Feito para o dia do evento"
          title="Tudo o que precisa funcionar, funciona"
        >
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Smartphone,
                title: 'Pensado para o celular',
                text: 'Botões grandes, uso com uma mão e nada para instalar.',
              },
              {
                icon: Users,
                title: 'Até 200 pessoas por sala',
                text: 'Do grupo pequeno ao auditório cheio.',
              },
              {
                icon: RefreshCw,
                title: 'Reconexão automática',
                text: 'Atualizou a página? Volta de onde parou.',
              },
              {
                icon: Zap,
                title: 'Tempo real de verdade',
                text: 'Respostas confirmadas em milissegundos.',
              },
              {
                icon: Lock,
                title: 'Resultados privados',
                text: 'Cada participante vê só o próprio desempenho.',
              },
              {
                icon: ListChecks,
                title: 'Enquetes sem pontuação',
                text: 'Colete opiniões no meio do quiz.',
              },
              {
                icon: BarChart3,
                title: 'Métricas por pergunta',
                text: 'Descubra o que o público não entendeu.',
              },
              {
                icon: FileSpreadsheet,
                title: 'Exporte seus dados',
                text: 'CSV e Excel prontos para compartilhar.',
              },
            ].map((f) => (
              <li
                key={f.title}
                className="grid content-start gap-2 rounded-2xl border border-border bg-surface p-5"
              >
                <f.icon className="size-6 text-primary" aria-hidden />
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* --------------------------------- Planos -------------------------------- */}
        <Pricing signupHref={signupHref} loggedIn={!!user} />

        {/* --------------------------------- Dúvidas ------------------------------- */}
        <Section id="duvidas" eyebrow="Dúvidas" title="Perguntas frequentes" narrow>
          <div className="grid gap-3">
            {FAQ.map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl border border-border bg-surface px-5 py-4 open:shadow-sm"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span
                    aria-hidden
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-lg leading-none transition-transform group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* ------------------------------- CTA final ------------------------------- */}
        <section aria-labelledby="cta-title" className="px-4 pb-20 sm:px-6">
          <div className="relative mx-auto grid max-w-6xl justify-items-center gap-5 overflow-hidden rounded-3xl bg-gradient-to-br from-primary-strong via-primary to-deep px-6 py-14 text-center text-white">
            <h2
              id="cta-title"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Sua próxima apresentação vai ser lembrada.
            </h2>
            <p className="max-w-xl text-blue-100">
              Crie sua conta grátis e faça o primeiro quiz hoje. Leva menos de um minuto.
            </p>
            <Button asChild size="lg" className="bg-white text-primary-strong hover:bg-blue-50">
              <Link to={user ? '/dashboard' : signupHref}>
                {user ? 'Ir para o painel' : 'Começar agora — é grátis'} <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="grid gap-2">
            <Logo />
            <p className="text-sm text-muted-foreground">
              Quizzes e apresentações interativas ao vivo. Pronuncia-se “Azute”.
            </p>
          </div>
          <nav aria-label="Rodapé" className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            <Link to="/entrar" className="hover:text-primary">
              Entrar com PIN
            </Link>
            <Link to="/login" className="hover:text-primary">
              Entrar no painel
            </Link>
            <Link to="/cadastro" className="hover:text-primary">
              Criar conta
            </Link>
            <a href="#planos" className="hover:text-primary">
              Planos
            </a>
          </nav>
        </div>
        <p className="border-t border-border py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} AZhoot. Todos os direitos reservados.
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function Section({
  id,
  eyebrow,
  title,
  children,
  narrow,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  narrow?: boolean;
}) {
  const hid = `${id ?? eyebrow.toLowerCase().replace(/\W+/g, '-')}-title`;
  return (
    <section id={id} aria-labelledby={hid} className="scroll-mt-20 px-4 py-20 sm:px-6">
      <div className={cn('mx-auto grid gap-10', narrow ? 'max-w-3xl' : 'max-w-6xl')}>
        <div className="grid justify-items-center gap-2 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary-strong dark:text-blue-300">
            {eyebrow}
          </p>
          <h2 id={hid} className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

function Feature({
  eyebrow,
  title,
  text,
  bullets,
  img,
  reverse,
  dark,
}: {
  eyebrow: string;
  title: string;
  text: string;
  bullets: string[];
  img: { src: string; w: number; h: number; alt: string };
  reverse?: boolean;
  dark?: boolean;
}) {
  return (
    <section className={cn('px-4 py-16 sm:px-6 lg:py-24', dark && 'bg-night text-white')}>
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className={cn('grid gap-4', reverse && 'lg:order-2')}>
          <p
            className={cn(
              'text-sm font-semibold uppercase tracking-wide',
              dark ? 'text-blue-300' : 'text-primary-strong dark:text-blue-300',
            )}
          >
            {eyebrow}
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
          <p className={cn('text-lg', dark ? 'text-slate-300' : 'text-muted-foreground')}>{text}</p>
          <ul className="grid gap-2">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-2 font-medium">
                <Check
                  className={cn('size-5 shrink-0', dark ? 'text-green-400' : 'text-success')}
                  aria-hidden
                />{' '}
                {b}
              </li>
            ))}
          </ul>
        </div>
        <figure
          className={cn(
            'overflow-hidden rounded-2xl border shadow-xl',
            dark ? 'border-white/10 shadow-black/40' : 'border-border shadow-slate-900/10',
          )}
        >
          <img
            src={img.src}
            width={img.w}
            height={img.h}
            alt={img.alt}
            loading="lazy"
            decoding="async"
            className="block w-full"
          />
        </figure>
      </div>
    </section>
  );
}

function limit(n: number | null, one: string, many: string) {
  if (n == null) return `${many.charAt(0).toUpperCase()}${many.slice(1)} ilimitados`;
  return `${n} ${n === 1 ? one : many}`;
}

function Pricing({ signupHref, loggedIn }: { signupHref: string; loggedIn: boolean }) {
  const q = useQuery({
    queryKey: ['public', 'plans'],
    queryFn: () => api<{ items: PlanDto[] }>('/public/plans'),
    staleTime: 60_000,
    retry: 1,
  });
  const plans = (q.data?.items.length ? q.data.items : FALLBACK_PLANS)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const monthly = plans.find((p) => p.id === 'MONTHLY');
  const yearly = plans.find((p) => p.id === 'YEARLY');
  const savings =
    monthly && yearly && monthly.priceCents > 0
      ? Math.round((1 - yearly.priceCents / (monthly.priceCents * 12)) * 100)
      : 0;
  const cta = loggedIn ? '/planos' : signupHref;

  return (
    <Section id="planos" eyebrow="Planos" title="Comece grátis. Cresça quando quiser.">
      <div
        className={cn('grid gap-6 md:grid-cols-3', q.isPending && 'opacity-70')}
        aria-busy={q.isPending}
      >
        {plans.map((p) => {
          const featured = p.id === 'YEARLY';
          const price = p.priceCents === 0 ? 'R$ 0' : formatBRL(p.priceCents);
          const period = p.interval === 'YEARLY' ? '/ano' : p.interval === 'MONTHLY' ? '/mês' : '';
          return (
            <article
              key={p.id}
              aria-labelledby={`plano-${p.id}`}
              className={cn(
                'relative flex flex-col gap-5 rounded-3xl border p-6',
                featured
                  ? 'border-primary bg-night text-white shadow-xl shadow-blue-900/20 md:-my-3 md:py-9'
                  : 'border-border bg-surface',
              )}
            >
              {featured && (
                <p className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">
                  <Crown className="size-3.5" aria-hidden /> Mais completo
                </p>
              )}
              <div className="grid gap-1">
                <h3 id={`plano-${p.id}`} className="font-display text-xl font-semibold">
                  {p.name}
                </h3>
                {p.description && (
                  <p
                    className={cn('text-sm', featured ? 'text-slate-300' : 'text-muted-foreground')}
                  >
                    {p.description}
                  </p>
                )}
              </div>
              <p>
                <span className="font-display text-4xl font-bold tracking-tight">{price}</span>
                <span
                  className={cn('text-sm', featured ? 'text-slate-300' : 'text-muted-foreground')}
                >
                  {period}
                </span>
                {p.interval === 'YEARLY' && p.priceCents > 0 && (
                  <span
                    className={cn(
                      'mt-1 block text-sm',
                      featured ? 'text-blue-200' : 'text-muted-foreground',
                    )}
                  >
                    equivale a {formatBRL(Math.round(p.priceCents / 12))}/mês
                    {savings > 0 && ` · economize ${savings}%`}
                  </span>
                )}
              </p>
              <ul className="grid gap-2.5 text-sm">
                {[
                  limit(p.maxQuizzes, 'quiz', 'quizzes'),
                  `Até ${p.maxParticipants} pessoas por sessão`,
                  limit(p.maxUsers, 'usuário', 'usuários'),
                  ...p.features.filter((f) => !/quizzes|pessoas|usu[aá]rio/i.test(f)),
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        featured ? 'text-green-400' : 'text-success',
                      )}
                      aria-hidden
                    />{' '}
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                asChild
                size="lg"
                variant={featured ? 'default' : p.id === 'FREE' ? 'outline' : 'default'}
                className="mt-auto w-full"
              >
                <Link to={loggedIn || p.id === 'FREE' ? cta : `${cta}?plano=${p.id}`}>
                  {p.id === 'FREE' ? 'Começar grátis' : `Assinar ${p.name}`}
                </Link>
              </Button>
            </article>
          );
        })}
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Pague com PIX, boleto ou cartão. Cancele quando quiser — você continua com o plano até o fim
        do período pago.
      </p>
    </Section>
  );
}

const FAQ = [
  {
    q: 'Os participantes precisam baixar um aplicativo ou criar conta?',
    a: 'Não. Eles acessam pelo navegador do celular, digitam o PIN (ou leem o QR Code) e escolhem um apelido. Só quem cria os quizzes precisa de conta.',
  },
  {
    q: 'Quantas pessoas podem jogar ao mesmo tempo?',
    a: 'Depende do plano: 5 no Gratuito, 20 no Mensal e até 200 por sessão no Anual.',
  },
  {
    q: 'Quais formas de pagamento são aceitas?',
    a: 'PIX, boleto e cartão de crédito. A cobrança é recorrente (mensal ou anual) e você recebe um aviso por e-mail antes do vencimento.',
  },
  {
    q: 'Posso mudar de plano ou cancelar?',
    a: 'Sim, a qualquer momento pelo painel. Upgrades valem assim que o pagamento é confirmado. Downgrades e cancelamentos valem na próxima renovação — até lá você usa tudo o que já pagou.',
  },
  {
    q: 'Posso usar em uma apresentação remota?',
    a: 'Sim. Compartilhe a tela do apresentador na videochamada e envie o PIN no chat. Cada pessoa responde pelo próprio celular ou computador.',
  },
  {
    q: 'O que acontece com os resultados?',
    a: 'Ficam salvos nos relatórios da sua conta, com classificação, desempenho por pergunta e exportação em CSV e Excel. Os resultados individuais são privados: a tela coletiva mostra apenas apelido e pontuação.',
  },
];
