import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, GripVertical } from 'lucide-react';
import { QUESTION_TYPE_LABELS } from '@azhoot/contracts';
import { cn } from '@azhoot/ui';
import type { EditorQuestion } from '@/lib/types';

interface Props {
  questions: EditorQuestion[];
  selected: number;
  issuesByIndex: Map<number, number>;
  readOnly: boolean;
  onSelect: (i: number) => void;
  onReorder: (next: EditorQuestion[], newSelected: number) => void;
}

function Item({
  q,
  index,
  active,
  issues,
  readOnly,
  onSelect,
}: {
  q: EditorQuestion;
  index: number;
  active: boolean;
  issues: number;
  readOnly: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: q.key,
    disabled: readOnly,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex items-stretch rounded-xl border bg-surface transition-shadow',
        active ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40',
        isDragging && 'z-10 shadow-lg',
      )}
    >
      {!readOnly && (
        <button
          type="button"
          className="flex w-8 shrink-0 cursor-grab items-center justify-center rounded-l-xl text-muted-foreground hover:bg-muted active:cursor-grabbing"
          aria-label={`Reordenar pergunta ${index + 1}. Use espaço e as setas.`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 px-3 py-2.5 text-left"
        aria-current={active ? 'true' : undefined}
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span>{index + 1}</span>
          <span>·</span>
          <span className="truncate">{QUESTION_TYPE_LABELS[q.type]}</span>
          {issues > 0 && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-danger"
              title={`${issues} problema(s)`}
            >
              <AlertCircle className="size-3.5" aria-hidden />
              <span className="sr-only">{issues} problema(s)</span>
              {issues}
            </span>
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 text-sm font-medium">
          {q.prompt || <em className="text-muted-foreground">Sem enunciado</em>}
        </span>
      </button>
    </li>
  );
}

export function QuestionList({
  questions,
  selected,
  issuesByIndex,
  readOnly,
  onSelect,
  onReorder,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = questions.findIndex((q) => q.key === e.active.id);
    const to = questions.findIndex((q) => q.key === e.over!.id);
    const selectedKey = questions[selected]?.key;
    const next = arrayMove(questions, from, to);
    onReorder(
      next,
      Math.max(
        0,
        next.findIndex((q) => q.key === selectedKey),
      ),
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Pergunta ${questions.findIndex((q) => q.key === active.id) + 1} selecionada.`,
          onDragOver: ({ over }) =>
            over ? `Sobre a posição ${questions.findIndex((q) => q.key === over.id) + 1}.` : '',
          onDragEnd: ({ over }) =>
            over
              ? `Pergunta movida para a posição ${questions.findIndex((q) => q.key === over.id) + 1}.`
              : 'Movimento cancelado.',
          onDragCancel: () => 'Movimento cancelado.',
        },
      }}
    >
      <SortableContext items={questions.map((q) => q.key)} strategy={verticalListSortingStrategy}>
        <ol className="grid gap-2" aria-label="Perguntas do quiz">
          {questions.map((q, i) => (
            <Item
              key={q.key}
              q={q}
              index={i}
              active={i === selected}
              issues={issuesByIndex.get(i) ?? 0}
              readOnly={readOnly}
              onSelect={() => onSelect(i)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
