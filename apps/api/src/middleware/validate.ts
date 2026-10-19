import type { z } from 'zod';
import { AppError } from '../lib/errors';

/** Valida dados de entrada com Zod e lança VALIDATION_FAILED com detalhes por campo. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || '_';
      if (!fields[path]) fields[path] = issue.message;
    }
    throw new AppError('VALIDATION_FAILED', { fields });
  }
  return result.data;
}
