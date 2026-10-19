import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SessionListItem } from '@azhoot/contracts';
import { Button, Card, EmptyState, ErrorState, Input, Skeleton } from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { SessionStatusBadge } from '@/components/StatusBadge';
import { api, describeError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export default function ReportsPage() {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['reports', search.trim()],
    queryFn: () =>
      api<{ items: SessionListItem[] }>(
        `/reports/sessions${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`,
      ),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Histórico de sessões, resultados e exportações."
      />
      <label className="relative mb-4 block max-w-md">
        <span className="sr-only">Buscar por quiz</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Buscar por quiz"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorState
          description={describeError(q.error)}
          action={<Button onClick={() => q.refetch()}>Tentar novamente</Button>}
        />
      ) : q.data.items.length === 0 ? (
        <EmptyState
          title="Nenhuma sessão encontrada"
          description="As sessões apresentadas aparecem aqui com seus resultados."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Sessões</caption>
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Quiz
                </th>
                <th scope="col" className="px-4 py-3">
                  Apresentador
                </th>
                <th scope="col" className="px-4 py-3">
                  Início
                </th>
                <th scope="col" className="px-4 py-3">
                  Fim
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Participantes
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((s) => (
                <tr key={s.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/relatorios/${s.id}`} className="hover:text-primary hover:underline">
                      {s.quizTitle}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{s.hostName}</td>
                  <td className="px-4 py-3">{formatDateTime(s.startedAt ?? s.createdAt)}</td>
                  <td className="px-4 py-3">{formatDateTime(s.endedAt)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.participantCount}</td>
                  <td className="px-4 py-3">
                    <SessionStatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
