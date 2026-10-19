import { ArrowDown, ArrowUp, Check, Copy, Plus, Trash2 } from 'lucide-react';
import {
  LIMITS,
  QUESTION_DURATIONS,
  QUESTION_POINTS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type PublishIssue,
  type QuestionType,
} from '@azhoot/contracts';
import { Button, Card, CardContent, cn, Field, Input, Select, Textarea } from '@azhoot/ui';
import { OptionChip } from '@/components/game/options';
import type { EditorQuestion } from '@/lib/types';
import { changeType, newKey } from './editorModel';
import { ImageUpload } from './ImageUpload';

interface Props {
  question: EditorQuestion;
  index: number;
  issues: PublishIssue[];
  readOnly: boolean;
  onChange: (q: EditorQuestion) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function QuestionForm({
  question: q,
  index,
  issues,
  readOnly,
  onChange,
  onDuplicate,
  onDelete,
}: Props) {
  const set = (patch: Partial<EditorQuestion>) => onChange({ ...q, ...patch });
  const issueFor = (path: string) =>
    issues.find((i) => i.path.endsWith(path))?.message.replace(/^Pergunta \d+: /, '');
  const optionIssue = issues
    .filter((i) => /\.options$/.test(i.path))
    .map((i) => i.message.replace(/^Pergunta \d+: /, ''));
  const multi = q.type === 'MULTIPLE_CHOICE';
  const poll = q.type === 'POLL';
  const tf = q.type === 'TRUE_FALSE';
  const idp = `q${index}`;

  function setOption(i: number, patch: Partial<EditorQuestion['options'][number]>) {
    set({ options: q.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  }

  function toggleCorrect(i: number) {
    if (poll) return;
    if (multi) setOption(i, { isCorrect: !q.options[i]!.isCorrect });
    else set({ options: q.options.map((o, j) => ({ ...o, isCorrect: j === i })) });
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= q.options.length) return;
    const next = [...q.options];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ options: next });
  }

  return (
    <Card>
      <CardContent className="grid gap-5 pt-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field id={`${idp}-type`} label="Tipo de pergunta" className="min-w-52 flex-1">
            {(p) => (
              <Select
                {...p}
                value={q.type}
                disabled={readOnly}
                onChange={(e) => onChange(changeType(q, e.target.value as QuestionType))}
              >
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {QUESTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id={`${idp}-time`} label="Tempo" className="w-32">
            {(p) => (
              <Select
                {...p}
                value={q.durationSeconds}
                disabled={readOnly}
                onChange={(e) => set({ durationSeconds: Number(e.target.value) })}
              >
                {QUESTION_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} s
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id={`${idp}-points`} label="Pontos" className="w-36">
            {(p) => (
              <Select
                {...p}
                value={poll ? 0 : q.basePoints}
                disabled={readOnly || poll}
                onChange={(e) => set({ basePoints: Number(e.target.value) })}
              >
                {QUESTION_POINTS.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt === 0 ? 'Sem pontos' : pt.toLocaleString('pt-BR')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {!readOnly && (
            <div className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onDuplicate}
                aria-label="Duplicar pergunta"
                title="Duplicar pergunta"
              >
                <Copy />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onDelete}
                aria-label="Excluir pergunta"
                title="Excluir pergunta"
                className="text-danger"
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </div>

        <Field
          id={`${idp}-prompt`}
          label="Enunciado"
          error={issueFor('prompt')}
          hint={`${q.prompt.length}/${LIMITS.promptMax} caracteres`}
        >
          {(p) => (
            <Textarea
              {...p}
              value={q.prompt}
              readOnly={readOnly}
              maxLength={LIMITS.promptMax}
              rows={3}
              placeholder="Digite a pergunta"
              className="text-base font-medium"
              onChange={(e) => set({ prompt: e.target.value })}
            />
          )}
        </Field>

        <ImageUpload
          label="Adicionar imagem à pergunta"
          value={q.imageUrl}
          disabled={readOnly}
          onChange={(imageUrl) => set({ imageUrl })}
        />

        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">
            Alternativas{' '}
            <span className="font-normal text-muted-foreground">
              {poll
                ? '(enquete: sem resposta correta)'
                : multi
                  ? '(marque todas as corretas)'
                  : '(marque a correta)'}
            </span>
          </legend>
          {optionIssue.length > 0 && (
            <ul className="grid gap-1 text-xs font-medium text-danger" role="alert">
              {optionIssue.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <ul className="grid gap-2">
            {q.options.map((o, i) => {
              const err = issueFor(`options.${i}.text`);
              return (
                <li
                  key={o.key}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border p-2',
                    o.isCorrect && !poll ? 'border-success bg-success/5' : 'border-border',
                  )}
                >
                  <OptionChip index={i} />
                  <label className="sr-only" htmlFor={`${idp}-opt-${i}`}>
                    Texto da alternativa {i + 1}
                  </label>
                  <Input
                    id={`${idp}-opt-${i}`}
                    value={o.text}
                    readOnly={readOnly || tf}
                    maxLength={LIMITS.optionTextMax}
                    placeholder={`Alternativa ${i + 1}`}
                    aria-invalid={err ? true : undefined}
                    className="min-w-0 flex-1"
                    onChange={(e) => setOption(i, { text: e.target.value })}
                  />
                  {!poll && (
                    <button
                      type="button"
                      role={multi ? 'checkbox' : 'radio'}
                      aria-checked={o.isCorrect}
                      disabled={readOnly}
                      onClick={() => toggleCorrect(i)}
                      className={cn(
                        'flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors',
                        o.isCorrect
                          ? 'border-green-700 bg-green-700 text-white'
                          : 'border-border text-muted-foreground hover:border-success hover:text-success-strong',
                      )}
                      aria-label={`Alternativa ${i + 1} correta`}
                    >
                      <Check className="size-4" aria-hidden />{' '}
                      <span className="hidden sm:inline">Correta</span>
                    </button>
                  )}
                  {!readOnly && !tf && (
                    <div className="flex shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label={`Mover alternativa ${i + 1} para cima`}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        disabled={i === q.options.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={`Mover alternativa ${i + 1} para baixo`}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 text-danger"
                        disabled={q.options.length <= LIMITS.optionsMin}
                        onClick={() => set({ options: q.options.filter((_, j) => j !== i) })}
                        aria-label={`Remover alternativa ${i + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {!readOnly && !tf && q.options.length < LIMITS.optionsMax && (
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() =>
                set({
                  options: [
                    ...q.options,
                    { key: newKey(), text: '', imageUrl: null, isCorrect: false },
                  ],
                })
              }
            >
              <Plus /> Adicionar alternativa
            </Button>
          )}
        </fieldset>

        <Field
          id={`${idp}-explanation`}
          label="Explicação (opcional)"
          hint="Exibida depois da revelação da resposta."
        >
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={q.explanation ?? ''}
              readOnly={readOnly}
              maxLength={LIMITS.explanationMax}
              onChange={(e) => set({ explanation: e.target.value || null })}
            />
          )}
        </Field>
      </CardContent>
    </Card>
  );
}
