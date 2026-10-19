import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CloudOff,
  Eye,
  Loader2,
  Play,
  Plus,
  Rocket,
  Settings2,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  LIMITS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  validateQuizForPublish,
  type PublishIssue,
  type QuestionDraftInput,
  type QuestionType,
} from '@azhoot/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Textarea,
} from '@azhoot/ui';
import { QuizStatusBadge } from '@/components/StatusBadge';
import {
  duplicateQuestion,
  fromDetail,
  fromGenerated,
  mergeServerIds,
  newQuestion,
  toPayload,
  toQuestionDraft,
  type EditorDraft,
} from '@/components/quiz/editorModel';
import { GenerateAiDialog } from '@/components/quiz/GenerateAiDialog';
import { ImageUpload } from '@/components/quiz/ImageUpload';
import { PreviewDialog } from '@/components/quiz/PreviewDialog';
import { PublishDialog } from '@/components/quiz/PublishDialog';
import { QuestionForm } from '@/components/quiz/QuestionForm';
import { QuestionList } from '@/components/quiz/QuestionList';
import { api, ApiError, describeError } from '@/lib/api';
import { formatTime } from '@/lib/format';
import type { QuizDetail, SaveDraftResponse } from '@/lib/types';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
const AUTOSAVE_MS = 900;

function SaveIndicator({
  state,
  savedAt,
  onRetry,
}: {
  state: SaveState;
  savedAt: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
      {state === 'saving' && (
        <>
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden /> Salvando…
        </>
      )}
      {state === 'saved' && (
        <>
          <CheckCircle2 className="size-4 text-success" aria-hidden /> Rascunho salvo{' '}
          {savedAt ? `às ${formatTime(savedAt)}` : ''}
        </>
      )}
      {state === 'dirty' && <span className="text-muted-foreground">Alterações não salvas…</span>}
      {state === 'error' && (
        <>
          <CloudOff className="size-4 text-danger" aria-hidden />
          <span className="text-danger">Erro ao salvar.</span>
          <Button variant="link" className="h-auto" onClick={onRetry}>
            Tentar novamente
          </Button>
        </>
      )}
    </div>
  );
}

export default function QuizEditorPage() {
  const { quizId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['quiz', quizId],
    queryFn: () => api<QuizDetail>(`/quizzes/${quizId}`),
  });

  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [meta, setMeta] = useState<Pick<
    QuizDetail,
    | 'status'
    | 'hasDraft'
    | 'isPublished'
    | 'publishedVersionNumber'
    | 'editingVersionNumber'
    | 'canEdit'
    | 'sessionCount'
  > | null>(null);
  const [selected, setSelected] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<PublishIssue[] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const version = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  const draftRef = useRef<EditorDraft | null>(null);
  draftRef.current = draft;

  // Inicializa a partir do servidor (uma vez por carregamento)
  useEffect(() => {
    if (detail.data && !draft) {
      setDraft(fromDetail(detail.data));
      setMeta(detail.data);
      setSavedAt(detail.data.savedAt);
    }
  }, [detail.data, draft]);

  const readOnly = !meta?.canEdit;

  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current || readOnly) return;
    if (saving.current) await saving.current;
    const v = version.current;
    setSaveState('saving');
    const run = (async () => {
      try {
        const res = await api<SaveDraftResponse>(`/quizzes/${quizId}`, {
          method: 'PUT',
          body: toPayload(current),
        });
        setSavedAt(res.savedAt);
        setSaveError(null);
        setMeta((m) =>
          m
            ? {
                ...m,
                hasDraft: m.isPublished ? true : m.hasDraft,
                editingVersionNumber: res.versionNumber,
              }
            : m,
        );
        if (v === version.current) {
          setDraft((d) => (d ? mergeServerIds(d, res.questions) : d));
          setSaveState('saved');
        } else {
          setSaveState('dirty');
        }
      } catch (err) {
        setSaveState('error');
        setSaveError(describeError(err));
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [quizId, readOnly]);

  // Autosave com debounce
  useEffect(() => {
    if (saveState !== 'dirty') return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [draft, saveState, save]);

  // Aviso ao sair com alterações pendentes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveState === 'dirty' || saveState === 'saving' || saveState === 'error') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState]);

  const update = useCallback((fn: (d: EditorDraft) => EditorDraft) => {
    version.current++;
    setDraft((d) => (d ? fn(d) : d));
    setSaveState('dirty');
  }, []);

  const issues = useMemo(
    () =>
      draft
        ? validateQuizForPublish({
            title: draft.title,
            questions: draft.questions.map(toQuestionDraft),
          })
        : [],
    [draft],
  );
  const issuesByIndex = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of issues)
      if (i.questionIndex != null) m.set(i.questionIndex, (m.get(i.questionIndex) ?? 0) + 1);
    return m;
  }, [issues]);

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      if (saveState !== 'saved') await save();
      const res = await api<QuizDetail>(`/quizzes/${quizId}/publish`, { method: 'POST' });
      setMeta(res);
      setDraft(fromDetail(res));
      setSaveState('saved');
      setPublishOpen(false);
      qc.invalidateQueries({ queryKey: ['quizzes'] });
      toast.success(`Versão ${res.publishedVersionNumber} publicada!`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'QUIZ_INVALID') {
        setServerIssues((err.details.issues as PublishIssue[]) ?? []);
      } else setPublishError(describeError(err));
    } finally {
      setPublishing(false);
    }
  }

  async function discardDraft() {
    try {
      const res = await api<QuizDetail>(`/quizzes/${quizId}/discard-draft`, { method: 'POST' });
      setMeta(res);
      setDraft(fromDetail(res));
      setSelected(0);
      setSaveState('saved');
      toast.success('Alterações descartadas. Voltamos à versão publicada.');
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setConfirmDiscard(false);
    }
  }

  function addQuestion(type: QuestionType) {
    if (!draft || draft.questions.length >= LIMITS.questionsMax) return;
    update((d) => ({ ...d, questions: [...d.questions, newQuestion(type)] }));
    setSelected(draft.questions.length);
  }

  function addGenerated(generated: QuestionDraftInput[]) {
    if (!draft) return;
    const room = LIMITS.questionsMax - draft.questions.length;
    const toAdd = generated.slice(0, Math.max(0, room)).map(fromGenerated);
    if (!toAdd.length) return;
    const firstNew = draft.questions.length;
    update((d) => ({ ...d, questions: [...d.questions, ...toAdd] }));
    setSelected(firstNew);
  }

  if (detail.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-12" />
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (detail.isError) {
    return (
      <ErrorState
        title={
          detail.error instanceof ApiError && detail.error.status === 404
            ? 'Quiz não encontrado'
            : 'Não foi possível carregar o quiz'
        }
        description={describeError(detail.error)}
        action={
          <Button asChild>
            <Link to="/quizzes">Voltar aos quizzes</Link>
          </Button>
        }
      />
    );
  }
  if (!draft || !meta) return null;

  const current = draft.questions[selected];
  const currentIssues = issues.filter((i) => i.questionIndex === selected);
  const shownIssues = serverIssues ?? issues;

  return (
    <div className="grid gap-5">
      {/* Cabeçalho do editor */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/quizzes')}
            aria-label="Voltar aos quizzes"
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <label htmlFor="quiz-title" className="sr-only">
              Título do quiz
            </label>
            <input
              id="quiz-title"
              value={draft.title}
              readOnly={readOnly}
              maxLength={LIMITS.quizTitleMax}
              onChange={(e) => update((d) => ({ ...d, title: e.target.value }))}
              className="w-full min-w-0 rounded-lg bg-transparent px-1 font-display text-2xl font-bold outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
              placeholder="Título do quiz"
            />
            <div className="flex flex-wrap items-center gap-2 px-1">
              <QuizStatusBadge status={meta.status} hasDraft={meta.hasDraft && meta.isPublished} />
              {meta.publishedVersionNumber && (
                <span className="text-xs text-muted-foreground">
                  Versão publicada: v{meta.publishedVersionNumber}
                </span>
              )}
              {!readOnly && (meta.hasDraft || !meta.isPublished || saveState !== 'saved') && (
                <SaveIndicator state={saveState} savedAt={savedAt} onRetry={() => void save()} />
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDetailsOpen(true)}>
            <Settings2 /> Detalhes
          </Button>
          <Button
            variant="outline"
            onClick={() => setPreviewOpen(true)}
            disabled={draft.questions.length === 0}
          >
            <Eye /> Prévia
          </Button>
          {meta.isPublished && meta.status !== 'ARCHIVED' && (
            <Button variant="outline" asChild>
              <Link to={`/biblioteca?quiz=${quizId}`}>
                <Play /> Apresentar
              </Link>
            </Button>
          )}
          {!readOnly && meta.isPublished && meta.hasDraft && (
            <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
              <Undo2 /> Descartar alterações
            </Button>
          )}
          {!readOnly && (
            <Button
              onClick={() => {
                setServerIssues(null);
                setPublishError(null);
                setPublishOpen(true);
              }}
              disabled={meta.isPublished && !meta.hasDraft}
            >
              <Rocket /> {meta.isPublished ? 'Publicar alterações' : 'Publicar'}
              {issues.length > 0 && (
                <span
                  className="rounded-full bg-white/25 px-1.5 text-xs"
                  aria-label={`${issues.length} problema(s)`}
                >
                  {issues.length}
                </span>
              )}
            </Button>
          )}
        </div>
      </div>

      {saveError && saveState === 'error' && (
        <Alert variant="danger">Não foi possível salvar: {saveError}</Alert>
      )}
      {readOnly && (
        <Alert variant="info">
          {meta.status === 'ARCHIVED'
            ? 'Este quiz está arquivado. Restaure-o para editar.'
            : 'Você pode visualizar este quiz, mas não editá-lo.'}
        </Alert>
      )}
      {meta.isPublished && meta.hasDraft && !readOnly && (
        <Alert variant="warning">
          Você está editando um novo rascunho. As sessões usam a versão publicada (v
          {meta.publishedVersionNumber}) até você publicar as alterações.
        </Alert>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[300px_1fr]">
        <aside className="grid gap-3 lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Perguntas <span className="text-muted-foreground">({draft.questions.length})</span>
            </h2>
          </div>
          {draft.questions.length > 0 && (
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <QuestionList
                questions={draft.questions}
                selected={selected}
                issuesByIndex={issuesByIndex}
                readOnly={readOnly}
                onSelect={setSelected}
                onReorder={(next, sel) => {
                  update((d) => ({ ...d, questions: next }));
                  setSelected(sel);
                }}
              />
            </div>
          )}
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  disabled={draft.questions.length >= LIMITS.questionsMax}
                >
                  <Plus /> Adicionar pergunta
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {QUESTION_TYPES.map((t) => (
                  <DropdownMenuItem key={t} onSelect={() => addQuestion(t)}>
                    {QUESTION_TYPE_LABELS[t]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {draft.questions.length < LIMITS.questionsMax && (
            <Button
              variant="secondary"
              className="mt-2 w-full"
              onClick={() => setGenerateOpen(true)}
            >
              <Sparkles /> Gerar com IA
            </Button>
          )}
        </aside>

        <section aria-label="Edição da pergunta">
          {current ? (
            <>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                Pergunta {selected + 1}
                {currentIssues.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
                    <AlertCircle className="size-3.5" aria-hidden /> {currentIssues.length}{' '}
                    problema(s)
                  </span>
                )}
              </h2>
              <QuestionForm
                key={current.key}
                question={current}
                index={selected}
                issues={currentIssues}
                readOnly={readOnly}
                onChange={(q) =>
                  update((d) => ({
                    ...d,
                    questions: d.questions.map((x, i) => (i === selected ? q : x)),
                  }))
                }
                onDuplicate={() => {
                  update((d) => {
                    const qs = [...d.questions];
                    qs.splice(selected + 1, 0, duplicateQuestion(current));
                    return { ...d, questions: qs };
                  });
                  setSelected(selected + 1);
                }}
                onDelete={() => setConfirmDelete(selected)}
              />
            </>
          ) : (
            <EmptyState
              title="Nenhuma pergunta ainda"
              description="Adicione perguntas de única escolha, múltipla escolha, verdadeiro ou falso e enquetes."
              action={
                !readOnly && (
                  <Button onClick={() => addQuestion('SINGLE_CHOICE')}>
                    <Plus /> Adicionar a primeira pergunta
                  </Button>
                )
              }
            />
          )}
        </section>
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalhes do quiz</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field id="quiz-desc" label="Descrição">
              {(p) => (
                <Textarea
                  {...p}
                  readOnly={readOnly}
                  maxLength={LIMITS.quizDescriptionMax}
                  value={draft.description}
                  onChange={(e) => update((d) => ({ ...d, description: e.target.value }))}
                />
              )}
            </Field>
            <Field id="quiz-cat" label="Categoria">
              {(p) => (
                <Input
                  {...p}
                  readOnly={readOnly}
                  maxLength={LIMITS.quizCategoryMax}
                  value={draft.category}
                  onChange={(e) => update((d) => ({ ...d, category: e.target.value }))}
                />
              )}
            </Field>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Capa</span>
              <ImageUpload
                label="Enviar capa"
                value={draft.coverImageUrl}
                disabled={readOnly}
                onChange={(coverImageUrl) => update((d) => ({ ...d, coverImageUrl }))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Visibilidade: privada (somente administradores do AZhoot).
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setDetailsOpen(false)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        issues={shownIssues}
        serverError={publishError}
        publishing={publishing}
        isRepublish={meta.isPublished}
        onPublish={publish}
        onGoTo={(i) => i != null && setSelected(i)}
      />
      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        questions={draft.questions}
        start={selected}
      />
      <GenerateAiDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        remainingSlots={LIMITS.questionsMax - draft.questions.length}
        onGenerated={addGenerated}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Excluir pergunta?"
        description="A pergunta será removida deste rascunho."
        confirmLabel="Excluir"
        destructive
        onConfirm={() => {
          const idx = confirmDelete!;
          update((d) => ({ ...d, questions: d.questions.filter((_, i) => i !== idx) }));
          setSelected(Math.max(0, Math.min(idx, draft.questions.length - 2)));
          setConfirmDelete(null);
        }}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Descartar alterações?"
        description={`O rascunho será apagado e o editor voltará à versão publicada (v${meta.publishedVersionNumber}).`}
        confirmLabel="Descartar"
        destructive
        onConfirm={discardDraft}
      />
    </div>
  );
}
