import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { PublicQuestion } from '@azhoot/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@azhoot/ui';
import { AnswerPad } from '@/components/game/AnswerPad';
import { QuestionStage } from '@/components/game/QuestionStage';
import { Timer } from '@/components/game/Timer';
import type { EditorQuestion } from '@/lib/types';

function toPublic(q: EditorQuestion, index: number, total: number): PublicQuestion {
  return {
    id: q.key,
    index,
    total,
    type: q.type,
    prompt: q.prompt || 'Sem enunciado',
    imageUrl: q.imageUrl,
    durationSeconds: q.durationSeconds,
    basePoints: q.basePoints,
    options: q.options.map((o, i) => ({
      id: o.key,
      text: o.text || `Alternativa ${i + 1}`,
      imageUrl: o.imageUrl,
    })),
  };
}

export function PreviewDialog({
  open,
  onOpenChange,
  questions,
  start,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  questions: EditorQuestion[];
  start: number;
}) {
  const [i, setI] = useState(start);
  const q = questions[Math.min(i, questions.length - 1)];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setI(start);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Prévia</DialogTitle>
          <DialogDescription>
            Como a pergunta aparece na tela projetada e no celular do participante.
          </DialogDescription>
        </DialogHeader>
        {!q ? (
          <p className="text-sm text-muted-foreground">Adicione uma pergunta para visualizar.</p>
        ) : (
          <>
            <div className="grid items-start gap-6 lg:grid-cols-[1fr_280px]">
              <div className="bg-waves aspect-video overflow-hidden rounded-2xl p-5">
                <QuestionStage
                  compact
                  question={toPublic(q, i, questions.length)}
                  answeredCount={0}
                  timer={
                    <Timer
                      seconds={q.durationSeconds}
                      total={q.durationSeconds}
                      size={56}
                      className="text-white"
                    />
                  }
                />
              </div>
              <div className="mx-auto w-[260px] rounded-[2rem] border-8 border-slate-800 bg-slate-900 p-3 text-white shadow-xl">
                <div className="h-[460px]">
                  <AnswerPad
                    question={toPublic(q, i, questions.length)}
                    onSubmit={() => undefined}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" disabled={i === 0} onClick={() => setI((x) => x - 1)}>
                <ChevronLeft /> Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                {i + 1} de {questions.length}
              </span>
              <Button
                variant="outline"
                disabled={i >= questions.length - 1}
                onClick={() => setI((x) => x + 1)}
              >
                Próxima <ChevronRight />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
