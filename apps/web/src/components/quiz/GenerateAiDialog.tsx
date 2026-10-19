import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Paperclip, Sparkles, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AI_ATTACHMENT_ACCEPT,
  GEN_TYPE_LABELS,
  GEN_TYPES,
  LEVEL_EXAMPLES,
  MAX_AI_ATTACHMENT_IMAGES,
  MAX_AI_ATTACHMENT_MB,
  MAX_AI_ATTACHMENTS,
  MAX_GEN_QUESTIONS,
  generationCreditCost,
  type GenType,
  type QuestionDraftInput,
} from '@azhoot/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Textarea,
} from '@azhoot/ui';
import { ApiError, describeError } from '@/lib/api';
import { CREDITS_KEY, generateQuestions, useCredits } from '@/lib/ai';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quantas perguntas ainda cabem no plano (para não gerar além do limite). */
  remainingSlots: number;
  onGenerated: (questions: QuestionDraftInput[]) => void;
}

type AttachKind = 'pdf' | 'docx' | 'excel' | 'image' | null;

function attachKind(file: File): AttachKind {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext))
    return 'image';
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'docx' || file.type.includes('wordprocessingml')) return 'docx';
  if (
    ext === 'xlsx' ||
    ext === 'xls' ||
    file.type.includes('spreadsheetml') ||
    file.type === 'application/vnd.ms-excel'
  )
    return 'excel';
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function GenerateAiDialog({ open, onOpenChange, remainingSlots, onGenerated }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const credits = useCredits();
  const balance = credits.data?.balance ?? 0;
  const maxCount = Math.max(1, Math.min(MAX_GEN_QUESTIONS, remainingSlots || MAX_GEN_QUESTIONS));
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    theme: '',
    level: '',
    content: '',
    count: 5,
    type: 'VARIED' as GenType,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cost = generationCreditCost(files.length > 0);

  // Miniaturas das imagens: cria e libera object URLs conforme a lista muda.
  const previews = useMemo(() => {
    const map = new Map<File, string>();
    for (const f of files) if (attachKind(f) === 'image') map.set(f, URL.createObjectURL(f));
    return map;
  }, [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const m = useMutation({
    mutationFn: () =>
      generateQuestions(
        {
          theme: form.theme.trim(),
          level: form.level.trim() || undefined,
          content: form.content.trim() || undefined,
          count: Math.min(form.count, maxCount),
          type: form.type,
        },
        files,
      ),
    onSuccess: (res) => {
      qc.setQueryData(CREDITS_KEY, (old: typeof credits.data) =>
        old ? { ...old, balance: res.creditsRemaining } : old,
      );
      void qc.invalidateQueries({ queryKey: CREDITS_KEY });
      onGenerated(res.questions);
      onOpenChange(false);
      toast.success(
        `${res.questions.length} perguntas geradas (${res.creditsUsed} crédito${res.creditsUsed > 1 ? 's' : ''}). Restam ${res.creditsRemaining}.`,
      );
      setForm((f) => ({ ...f, theme: '', content: '' }));
      setFiles([]);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'NO_AI_CREDITS') {
        setError('Você está sem créditos de IA suficientes. Adicione créditos para continuar.');
      } else setError(describeError(e));
    },
  });

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const incoming = Array.from(list);
    setFiles((prev) => {
      let next = [...prev];
      for (const f of incoming) {
        if (attachKind(f) === null) {
          setError(`"${f.name}" não é um tipo aceito (PDF, DOCX, Excel ou imagem).`);
          continue;
        }
        if (f.size > MAX_AI_ATTACHMENT_MB * 1024 * 1024) {
          setError(`"${f.name}" passa de ${MAX_AI_ATTACHMENT_MB} MB.`);
          continue;
        }
        if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
        next.push(f);
      }
      if (next.length > MAX_AI_ATTACHMENTS) {
        setError(`Máximo de ${MAX_AI_ATTACHMENTS} anexos.`);
        next = next.slice(0, MAX_AI_ATTACHMENTS);
      }
      if (next.filter((f) => attachKind(f) === 'image').length > MAX_AI_ATTACHMENT_IMAGES) {
        setError(`Máximo de ${MAX_AI_ATTACHMENT_IMAGES} imagens.`);
        return prev;
      }
      return next;
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  function removeFile(file: File) {
    setFiles((prev) => prev.filter((f) => f !== file));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.theme.trim().length < 3) return setError('Descreva o tema (mínimo 3 caracteres).');
    if (balance < cost)
      return setError(`Esta geração custa ${cost} créditos e você tem ${balance}.`);
    setError(null);
    m.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" aria-hidden /> Gerar perguntas com IA
            </DialogTitle>
            <DialogDescription>
              Descreva o que você quer e a IA cria as perguntas. Só texto consome 1 crédito; com
              anexos, 2 créditos. Você tem {balance}.
            </DialogDescription>
          </DialogHeader>

          <Field id="ai-theme" label="Tema">
            {(p) => (
              <Input
                {...p}
                value={form.theme}
                onChange={(e) => setForm({ ...form, theme: e.target.value })}
                placeholder="Ex.: Revolução Francesa, frações, boas práticas de segurança"
                maxLength={200}
                autoFocus
              />
            )}
          </Field>

          <Field id="ai-level" label="Nível / público (opcional)">
            {(p) => (
              <>
                <Input
                  {...p}
                  list="ai-levels"
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                  placeholder="Ex.: 6º ano do ensino fundamental, professores e acadêmicos"
                  maxLength={120}
                />
                <datalist id="ai-levels">
                  {LEVEL_EXAMPLES.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          <Field
            id="ai-content"
            label="Conteúdo ou fontes (opcional)"
            hint="Cole textos, tópicos ou links para a IA se basear."
          >
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                maxLength={8000}
              />
            )}
          </Field>

          {/* Anexos: PDF, DOCX, Excel ou imagem. Com anexos, a geração custa 2 créditos. */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Anexos (opcional)</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={files.length >= MAX_AI_ATTACHMENTS}
              >
                <Paperclip aria-hidden /> Anexar arquivo
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              PDF, DOCX, Excel ou imagem — até {MAX_AI_ATTACHMENT_MB} MB cada. Com anexo, a geração
              passa a custar <strong>2 créditos</strong>.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={AI_ATTACHMENT_ACCEPT}
              multiple
              className="sr-only"
              onChange={(e) => addFiles(e.target.files)}
            />
            {files.length > 0 && (
              <ul className="grid gap-2">
                {files.map((file) => {
                  const kind = attachKind(file);
                  const preview = previews.get(file);
                  return (
                    <li
                      key={`${file.name}-${file.size}`}
                      className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-2"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-background">
                        {preview ? (
                          <img src={preview} alt="" className="size-10 rounded object-cover" />
                        ) : kind === 'excel' ? (
                          <FileSpreadsheet className="size-5 text-emerald-600" aria-hidden />
                        ) : (
                          <FileText className="size-5 text-primary" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{file.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatSize(file.size)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(file)}
                        className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                        aria-label={`Remover ${file.name}`}
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field id="ai-count" label="Quantidade" hint={`Até ${maxCount} no seu plano`}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={maxCount}
                  value={form.count}
                  onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
                />
              )}
            </Field>
            <Field id="ai-type" label="Tipo de pergunta">
              {(p) => (
                <Select
                  {...p}
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as GenType })}
                >
                  {GEN_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {GEN_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {error && (
            <Alert variant="danger">
              {error}
              {balance < cost && (
                <button
                  type="button"
                  className="ml-1 font-semibold underline"
                  onClick={() => {
                    onOpenChange(false);
                    navigate('/creditos');
                  }}
                >
                  Adicionar créditos
                </button>
              )}
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={m.isPending} disabled={balance < cost}>
              <Wand2 aria-hidden /> Gerar {form.count} · {cost} crédito{cost > 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
