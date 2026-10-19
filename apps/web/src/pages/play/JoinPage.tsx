import { ArrowLeft, LogIn } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { nicknameSchema, type JoinResponse, type PinLookupResponse } from '@azhoot/contracts';
import { Alert, Button, Input, Logo } from '@azhoot/ui';
import { api, ApiError, describeError } from '@/lib/api';
import { loadParticipant, saveParticipant } from '@/lib/participantStore';
import { useForcedDark } from '@/lib/theme';

export default function JoinPage() {
  useForcedDark();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [pin, setPin] = useState(params.get('pin')?.replace(/\D/g, '').slice(0, 6) ?? '');
  const [room, setRoom] = useState<PinLookupResponse | null>(null);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nickRef = useRef<HTMLInputElement>(null);
  const autoTried = useRef(false);

  async function lookup(value = pin) {
    setError(null);
    if (!/^\d{6}$/.test(value)) return setError('O PIN possui 6 dígitos.');
    setLoading(true);
    try {
      const r = await api<PinLookupResponse>(`/join/${value}`);
      const existing = loadParticipant(r.sessionId);
      if (existing) return navigate(`/jogar/${r.sessionId}`);
      if (!r.acceptingJoins)
        return setError('A partida já começou e esta sala não permite entrada tardia.');
      setRoom(r);
      setTimeout(() => nickRef.current?.focus(), 50);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'PIN_INVALID'
          ? 'PIN não encontrado ou sala encerrada. Confira os números.'
          : describeError(err),
      );
    } finally {
      setLoading(false);
    }
  }

  // QR Code: PIN já vem preenchido na URL
  useEffect(() => {
    if (!autoTried.current && /^\d{6}$/.test(pin)) {
      autoTried.current = true;
      void lookup(pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function join(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = nicknameSchema.safeParse(nickname);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setLoading(true);
    try {
      const res = await api<JoinResponse>(`/join/${pin}`, { body: { nickname: parsed.data } });
      saveParticipant(res);
      navigate(`/jogar/${res.sessionId}`, { replace: true });
    } catch (err) {
      setError(describeError(err));
      if (err instanceof ApiError && err.code === 'PIN_INVALID') setRoom(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-waves flex min-h-dvh flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 text-white">
      <Logo inverted className="mx-auto" />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-5">
        {!room ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
            className="grid gap-4"
            noValidate
          >
            <h1 className="text-center text-2xl font-bold">Digite o PIN da sala</h1>
            <label htmlFor="pin" className="sr-only">
              PIN da sala
            </label>
            <Input
              id="pin"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={pin}
              autoFocus={!pin}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'join-error' : undefined}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-16 border-white/20 bg-white text-center font-display text-3xl font-bold tracking-[0.4em] text-slate-900"
            />
            {error && (
              <Alert variant="danger" className="border-red-300/40 bg-red-500/15 text-white">
                <span id="join-error">{error}</span>
              </Alert>
            )}
            <Button type="submit" size="xl" loading={loading} disabled={pin.length !== 6}>
              Continuar
            </Button>
          </form>
        ) : (
          <form onSubmit={join} className="grid gap-4" noValidate>
            <div className="text-center">
              <p className="text-sm text-blue-200">Sala encontrada</p>
              <h1 className="text-2xl font-bold">{room.quizTitle}</h1>
            </div>
            <label htmlFor="nickname" className="text-center text-lg font-semibold">
              Seu apelido
            </label>
            <Input
              ref={nickRef}
              id="nickname"
              autoComplete="nickname"
              maxLength={24}
              value={nickname}
              placeholder="Como quer aparecer?"
              aria-invalid={error ? true : undefined}
              aria-describedby="nick-hint"
              onChange={(e) => setNickname(e.target.value)}
              className="h-14 border-white/20 bg-white text-center text-xl font-semibold text-slate-900"
            />
            <p id="nick-hint" className="text-center text-xs text-slate-300">
              De 2 a 24 caracteres. Seu apelido aparece na tela para todos.
            </p>
            {error && (
              <Alert variant="danger" className="border-red-300/40 bg-red-500/15 text-white">
                {error}
              </Alert>
            )}
            <Button type="submit" size="xl" loading={loading}>
              <LogIn /> Entrar na sala
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-slate-300 hover:bg-white/10 hover:text-white"
              onClick={() => {
                setRoom(null);
                setError(null);
              }}
            >
              <ArrowLeft /> Trocar PIN
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}
