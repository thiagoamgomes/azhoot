import { Link } from 'react-router-dom';
import { Button, Logo } from '@azhoot/ui';

function Shell({
  code,
  title,
  description,
  action,
}: {
  code: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-waves grid min-h-dvh place-items-center px-4 text-white">
      <div className="max-w-md text-center">
        <Logo inverted className="mb-8 justify-center" />
        <p className="font-display text-7xl font-bold text-blue-300">{code}</p>
        <h1 className="mt-2 text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-slate-300">{description}</p>
        <div className="mt-6 flex justify-center gap-2">
          {action ?? (
            <Button asChild>
              <Link to="/">Voltar ao início</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <Shell
      code="404"
      title="Página não encontrada"
      description="O endereço acessado não existe ou foi movido."
    />
  );
}

export function AccessDenied() {
  return (
    <Shell
      code="403"
      title="Acesso negado"
      description="Seu perfil não tem permissão para acessar esta área."
    />
  );
}

export function SessionUnavailable({ title, description }: { title: string; description: string }) {
  return (
    <Shell
      code="!"
      title={title}
      description={description}
      action={
        <Button asChild>
          <Link to="/entrar">Entrar em outra sala</Link>
        </Button>
      }
    />
  );
}
