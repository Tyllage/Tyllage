import { Router } from 'express';
import env from '../config/env.js';
import { checkDatabase } from '../config/db.js';
import { verifyToken, requireRole, BUYER_ROLES } from '../middleware/auth.js';
import { buyerController, notificationController, whatsappController } from '../controllers/index.js';
import { isOpenAIConfigured } from '../services/openaiService.js';
import { whatsappMode } from '../services/whatsappService.js';

const router = Router();

/** Health check for Railway. Reports status only — never credentials or infrastructure details. */
router.get('/health', async (_req, res) => {
  const database = await checkDatabase();
  res.status(database === 'connected' ? 200 : 503).json({
    success: database === 'connected',
    ...(database !== 'connected' && { message: 'Database is unreachable', code: 'SERVICE_UNAVAILABLE' }),
    data: {
      service: 'tyllage-api',
      status: database === 'connected' ? 'ok' : 'degraded',
      environment: env.NODE_ENV,
      database,
      integrations: {
        openai: isOpenAIConfigured() ? 'configured' : 'mock',
        whatsapp: whatsappMode() === 'LIVE' ? 'configured' : 'mock',
      },
      timestamp: new Date().toISOString(),
    },
  });
});

router.get('/buyers/me', verifyToken, requireRole(...BUYER_ROLES), buyerController.me);
router.patch('/buyers/me', verifyToken, requireRole(...BUYER_ROLES), buyerController.updateMe);

router.get('/notifications', verifyToken, notificationController.list);
router.post('/notifications/:id/read', verifyToken, notificationController.markRead);

router.get('/whatsapp/webhook', whatsappController.verify);
router.post('/whatsapp/webhook', whatsappController.receive);

export default router;
