import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  CheckCircle2,
  ListChecks,
  MessageSquare,
  Play,
  Plus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DashboardStats } from '@azhoot/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@azhoot/ui';
import { FrozenBanner } from '@/components/billing/AccountBanner';
import { PageHeader } from '@/components/layout/AdminLayout';
import { SessionStatusBadge } from '@/components/StatusBadge';
import { api, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Users }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      <p className="mt-3 font-display text-3xl font-bold">{value}</p>
    </Card>
  );
}

export default function DashboardPage() {
  const { can, user } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardStats>('/dashboard') });

  return (
    <>
      <PageHeader
        title={`Olá, ${user?.name?.split(' ')[0] ?? ''}`}
        description="Resumo das suas atividades no AZhoot."
        actions={
          <>
            {can('editQuizzes') && (
              <Button asChild variant="outline">
                <Link to="/quizzes/novo">
                  <Plus /> Criar quiz
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link to="/biblioteca">
                <Play /> Apresentar
              </Link>
            </Button>
          </>
        }
      />
      <FrozenBanner />
      {q.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState
          description={describeError(q.error)}
          action={<Button onClick={() => q.refetch()}>Tentar novamente</Button>}
        />
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Quizzes" value={formatNumber(q.data.totals.quizzes)} icon={ListChecks} />
            <Stat label="Sessões" value={formatNumber(q.data.totals.sessions)} icon={Play} />
            <Stat
              label="Participantes"
              value={formatNumber(q.data.totals.participants)}
              icon={Users}
            />
            <Stat
              label="Respostas"
              value={formatNumber(q.data.totals.answers)}
              icon={MessageSquare}
            />
            <Stat
              label="Taxa média de acerto"
              value={formatPercent(q.data.averageAccuracy)}
              icon={CheckCircle2}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Sessões recentes</CardTitle>
                <Button asChild variant="link">
                  <Link to="/relatorios">Ver todas</Link>
                </Button>
              </CardHeader>
              <CardContent>
                {q.data.recentSessions.length === 0 ? (
                  <EmptyState
                    title="Nenhuma sessão ainda"
                    description="Quando você apresentar um quiz, as sessões aparecerão aqui."
                    action={
                      <Button asChild>
                        <Link to="/biblioteca">Apresentar agora</Link>
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {q.data.recentSessions.map((s) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3"
                      >
                        <div className="min-w-0">
                          <Link
                            to={
                              s.status === 'FINISHED' || s.status === 'CANCELLED'
                                ? `/relatorios/${s.id}`
                                : `/apresentar/${s.id}`
                            }
                            className="font-medium hover:text-primary"
                          >
                            {s.quizTitle}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(s.createdAt)} · {s.participantCount} participante(s)
                          </p>
                        </div>
                        <SessionStatusBadge status={s.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Quizzes mais usados</CardTitle>
              </CardHeader>
              <CardContent>
                {q.data.topQuizzes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
                ) : (
                  <ol className="grid gap-3">
                    {q.data.topQuizzes.map((t, i) => (
                      <li key={t.quizId} className="flex items-center gap-3">
                        <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {t.title}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <BarChart3 className="size-3.5" aria-hidden /> {t.sessions}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
