import { useEffect, useState } from 'react';

/** Segundos restantes até `endsAt` usando a hora estimada do servidor. Atualiza 5x/s. */
export function useRemaining(endsAt: string | null | undefined, serverNow: () => number) {
  const calc = () => (endsAt ? Math.max(0, new Date(endsAt).getTime() - serverNow()) : 0);
  const [ms, setMs] = useState(calc);
  useEffect(() => {
    setMs(calc());
    if (!endsAt) return;
    const t = setInterval(() => setMs(calc()), 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);
  return { ms, seconds: Math.ceil(ms / 1000) };
}
