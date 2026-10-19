import { Router } from 'express';
import { appSettingsSchema } from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { parse } from '../../middleware/validate';
import { requireMaster } from '../account/middleware';
import { getSettings, saveSettings } from './service';

export function settingsRoutes(ctx: AppContext) {
  const r = Router();
  r.get('/', requireMaster(), async (_req, res) => {
    res.json(await getSettings(ctx));
  });
  r.put('/', requireMaster(), async (req, res) => {
    const input = parse(appSettingsSchema, req.body);
    const saved = await saveSettings(ctx, input);
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'settings.updated',
      metadata: {
        blocklistSize: input.nicknameBlocklist.length,
        retentionDays: input.retentionDays,
      },
      ip: req.ip,
      requestId: req.id,
    });
    res.json(saved);
  });
  return r;
}
