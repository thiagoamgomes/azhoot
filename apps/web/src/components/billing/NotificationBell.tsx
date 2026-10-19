import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { NotificationDto } from '@azhoot/contracts';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@azhoot/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: NotificationDto[]; unread: number }>('/account/notifications'),
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: (ids?: string[]) =>
      api('/account/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = q.data?.unread ?? 0;
  return (
    <DropdownMenu
      onOpenChange={(o) => o && unread > 0 && setTimeout(() => read.mutate(undefined), 1500)}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notificações (${unread} não lidas)` : 'Notificações'}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <p className="border-b border-border px-4 py-3 text-sm font-semibold">Notificações</p>
        <div className="max-h-96 overflow-y-auto p-1">
          {(q.data?.items ?? []).length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhuma notificação por aqui.
            </p>
          ) : (
            q.data!.items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="block min-h-0 py-2"
                onSelect={() => n.link && navigate(n.link)}
              >
                <p className={cn('text-sm', !n.readAt && 'font-semibold')}>{n.title}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {n.body.replace(/https?:\/\/\S+/g, '').trim()}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDateTime(n.createdAt)}
                </p>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
