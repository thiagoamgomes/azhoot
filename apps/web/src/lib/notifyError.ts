import { toast } from 'sonner';
import { ApiError, describeError } from './api';

const UPGRADE_CODES = new Set(['PLAN_LIMIT_QUIZZES', 'PLAN_LIMIT_USERS', 'ACCOUNT_FROZEN']);

export function isUpgradeError(err: unknown) {
  return err instanceof ApiError && UPGRADE_CODES.has(err.code);
}

/** Toast de erro; para limites do plano oferece o atalho para a página de planos. */
export function notifyError(err: unknown, goToPlans?: () => void) {
  if (isUpgradeError(err) && goToPlans) {
    toast.error(describeError(err), {
      action: { label: 'Ver planos', onClick: goToPlans },
      duration: 8000,
    });
  } else {
    toast.error(describeError(err));
  }
}
