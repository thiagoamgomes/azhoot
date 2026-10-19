import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { quizCreateSchema } from '@azhoot/contracts';
import { Alert, Button, Card, CardContent, Field, Input, Textarea } from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, describeError } from '@/lib/api';
import { isUpgradeError } from '@/lib/notifyError';
import type { QuizDetail } from '@/lib/types';

export default function QuizNewPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (body: object) => api<QuizDetail>('/quizzes', { body }),
    onSuccess: (quiz) => navigate(`/quizzes/${quiz.id}/editar`, { replace: true }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = quizCreateSchema.safeParse({ title, description, category });
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[String(i.path[0])] ??= i.message;
      setErrors(f);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Novo quiz"
        description="Dê um nome ao quiz. Você adiciona as perguntas no próximo passo."
      />
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={submit} noValidate className="grid gap-4">
            {create.isError && (
              <Alert variant="danger">
                {describeError(create.error)}{' '}
                {isUpgradeError(create.error) && (
                  <Link to="/planos" className="font-semibold text-primary underline">
                    Ver planos
                  </Link>
                )}
              </Alert>
            )}
            <Field id="title" label="Título" error={errors.title}>
              {(p) => (
                <Input
                  {...p}
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                />
              )}
            </Field>
            <Field id="description" label="Descrição (opcional)">
              {(p) => (
                <Textarea
                  {...p}
                  value={description}
                  maxLength={1000}
                  onChange={(e) => setDescription(e.target.value)}
                />
              )}
            </Field>
            <Field id="category" label="Categoria (opcional)" hint="Ex.: Treinamento, Evento, Aula">
              {(p) => (
                <Input
                  {...p}
                  value={category}
                  maxLength={60}
                  onChange={(e) => setCategory(e.target.value)}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate('/quizzes')}>
                Cancelar
              </Button>
              <Button type="submit" loading={create.isPending}>
                Criar e editar perguntas
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
