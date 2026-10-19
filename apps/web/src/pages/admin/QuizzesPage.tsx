import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Copy,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { QuizStatusBadge } from '@/components/StatusBadge';
import { api, describeError } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { notifyError } from '@/lib/notifyError';
import type { QuizDetail, QuizListItem } from '@/lib/types';

export default function QuizzesPage() {
  const { can } = useAuth();
  const canEdit = can('editQuizzes');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sort, setSort] = useState('updatedAt');
  const [toDelete, setToDelete] = useState<QuizListItem | null>(null);

  const params = new URLSearchParams({ status, sort, order: sort === 'title' ? 'asc' : 'desc' });
  if (search.trim()) params.set('search', search.trim());
  const list = useQuery({
    queryKey: ['quizzes', status, sort, search.trim()],
    queryFn: () => api<{ items: QuizListItem[] }>(`/quizzes?${params}`),
    placeholderData: (prev) => prev,
  });

  const action = useMutation({
    mutationFn: ({
      id,
      op,
    }: {
      id: string;
      op: 'duplicate' | 'archive' | 'unarchive' | 'delete';
    }) =>
      op === 'delete'
        ? api(`/quizzes/${id}`, { method: 'DELETE' })
        : api<QuizDetail>(`/quizzes/${id}/${op}`, { method: 'POST' }),
    onSuccess: (data, { op }) => {
      qc.invalidateQueries({ queryKey: ['quizzes'] });
      const msg = {
        duplicate: 'Quiz duplicado.',
        archive: 'Quiz arquivado.',
        unarchive: 'Quiz restaurado.',
        delete: 'Quiz excluído.',
      }[op];
      toast.success(msg);
      if (op === 'duplicate' && data) navigate(`/quizzes/${(data as QuizDetail).id}/editar`);
      setToDelete(null);
    },
    onError: (err) => notifyError(err, () => navigate('/planos')),
  });

  return (
    <>
      <PageHeader
        title="Quizzes"
        description="Crie, edite e publique seus quizzes."
        actions={
          canEdit && (
            <Button asChild>
              <Link to="/quizzes/novo">
                <Plus /> Novo quiz
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="relative">
          <span className="sr-only">Buscar quizzes</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            placeholder="Buscar por título ou categoria"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filtrar por status</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ALL">Todos (sem arquivados)</option>
            <option value="DRAFT">Rascunhos</option>
            <option value="PUBLISHED">Publicados</option>
            <option value="ARCHIVED">Arquivados</option>
          </Select>
        </label>
        <label>
          <span className="sr-only">Ordenar</span>
          <Select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="updatedAt">Atualizados recentemente</option>
            <option value="createdAt">Criados recentemente</option>
            <option value="title">Título (A–Z)</option>
            <option value="sessions">Mais usados</option>
          </Select>
        </label>
      </div>

      {list.isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState
          description={describeError(list.error)}
          action={<Button onClick={() => list.refetch()}>Tentar novamente</Button>}
        />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={
            search || status !== 'ALL' ? 'Nenhum quiz encontrado' : 'Você ainda não tem quizzes'
          }
          description={
            search || status !== 'ALL'
              ? 'Ajuste a busca ou os filtros.'
              : 'Comece criando seu primeiro quiz.'
          }
          action={
            canEdit && !search && status === 'ALL' ? (
              <Button asChild>
                <Link to="/quizzes/novo">
                  <Plus /> Criar quiz
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3" aria-label="Lista de quizzes">
          {list.data.items.map((quiz) => (
            <li key={quiz.id}>
              <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="hidden size-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary to-deep sm:block">
                    {quiz.coverImageUrl && (
                      <img
                        src={assetUrl(quiz.coverImageUrl)}
                        alt=""
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/quizzes/${quiz.id}/editar`}
                        className="truncate font-display text-base font-semibold hover:text-primary"
                      >
                        {quiz.title}
                      </Link>
                      <QuizStatusBadge status={quiz.status} hasDraft={quiz.hasDraft} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {quiz.questionCount} pergunta(s) · {quiz.sessionCount} sessão(ões)
                      {quiz.category ? ` · ${quiz.category}` : ''} · atualizado{' '}
                      {formatDateTime(quiz.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {quiz.isPublished && quiz.status !== 'ARCHIVED' && (
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/biblioteca?quiz=${quiz.id}`}>
                        <Play /> Apresentar
                      </Link>
                    </Button>
                  )}
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Ações de ${quiz.title}`}>
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => navigate(`/quizzes/${quiz.id}/editar`)}>
                          <Pencil /> {quiz.status === 'ARCHIVED' ? 'Visualizar' : 'Editar'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => action.mutate({ id: quiz.id, op: 'duplicate' })}
                        >
                          <Copy /> Duplicar
                        </DropdownMenuItem>
                        {quiz.status === 'ARCHIVED' ? (
                          <DropdownMenuItem
                            onSelect={() => action.mutate({ id: quiz.id, op: 'unarchive' })}
                          >
                            <ArchiveRestore /> Restaurar
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() => action.mutate({ id: quiz.id, op: 'archive' })}
                          >
                            <Archive /> Arquivar
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          disabled={quiz.sessionCount > 0}
                          onSelect={() => setToDelete(quiz)}
                        >
                          <Trash2 />{' '}
                          {quiz.sessionCount > 0 ? 'Excluir (possui sessões)' : 'Excluir'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir quiz?"
        description={`“${toDelete?.title ?? ''}” será excluído permanentemente. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        destructive
        loading={action.isPending}
        onConfirm={() => toDelete && action.mutate({ id: toDelete.id, op: 'delete' })}
      />
    </>
  );
}
