import type { AuthUser } from '@azhoot/contracts';
import type { Account, Plan } from '@azhoot/db';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      adminSession?: { id: string; csrfToken: string };
      account?: Account & { plan: Plan };
    }
  }
}

export {};
