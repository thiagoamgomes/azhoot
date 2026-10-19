import { GAME_STATUS_LABELS, type GameStatus, type QuizStatus } from '@azhoot/contracts';
import { Badge } from '@azhoot/ui';

export function QuizStatusBadge({ status, hasDraft }: { status: QuizStatus; hasDraft?: boolean }) {
  if (status === 'ARCHIVED') return <Badge variant="muted">Arquivado</Badge>;
  if (status === 'PUBLISHED')
    return (
      <span className="inline-flex flex-wrap gap-1">
        <Badge variant="success">Publicado</Badge>
        {hasDraft && <Badge variant="warning">Alterações não publicadas</Badge>}
      </span>
    );
  return <Badge variant="default">Rascunho</Badge>;
}

export function SessionStatusBadge({ status }: { status: string }) {
  const s = status as GameStatus;
  const variant = s === 'FINISHED' ? 'success' : s === 'CANCELLED' ? 'muted' : 'warning';
  return <Badge variant={variant}>{GAME_STATUS_LABELS[s] ?? status}</Badge>;
}
