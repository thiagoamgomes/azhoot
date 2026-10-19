import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { PublishIssue } from '@azhoot/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@azhoot/ui';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  issues: PublishIssue[];
  serverError?: string | null;
  publishing: boolean;
  isRepublish: boolean;
  onPublish: () => void;
  onGoTo: (questionIndex: number | undefined) => void;
}

export function PublishDialog({
  open,
  onOpenChange,
  issues,
  serverError,
  publishing,
  isRepublish,
  onPublish,
  onGoTo,
}: Props) {
  const ok = issues.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isRepublish ? 'Publicar nova versão' : 'Publicar quiz'}</DialogTitle>
          <DialogDescription>
            Publicar cria uma versão imutável usada pelas sessões. Sessões anteriores continuam com
            a versão que usaram.
          </DialogDescription>
        </DialogHeader>
        {serverError && <Alert variant="danger">{serverError}</Alert>}
        {ok ? (
          <Alert variant="success">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-success" aria-hidden /> Tudo certo! O quiz pode
              ser publicado.
            </span>
          </Alert>
        ) : (
          <div className="grid gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-danger">
              <AlertCircle className="size-4" aria-hidden /> Corrija {issues.length} problema(s)
              antes de publicar:
            </p>
            <ul className="grid max-h-72 gap-1 overflow-y-auto">
              {issues.map((i, k) => (
                <li key={`${i.path}-${k}`}>
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted"
                    onClick={() => {
                      onGoTo(i.questionIndex);
                      onOpenChange(false);
                    }}
                  >
                    {i.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar à edição
          </Button>
          <Button disabled={!ok} loading={publishing} onClick={onPublish}>
            Publicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
