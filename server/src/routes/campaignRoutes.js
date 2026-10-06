import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ROLES, FARM_ADMIN_ROLES } from '../middleware/auth.js';
import { campaignController as c, aiController } from '../controllers/index.js';

const router = Router();
router.use(verifyToken, requireRole(...FARM_ROLES));

router.get('/', requireFarmAccess, c.list);
router.post('/generate', requireRole(...FARM_ADMIN_ROLES), requireFarmAccess, c.generate);
router.get('/:id', c.get);
router.patch('/:id', requireRole(...FARM_ADMIN_ROLES), c.update);
router.post('/:id/approve', requireRole(...FARM_ADMIN_ROLES), c.approve);
router.post('/:id/send', requireRole(...FARM_ADMIN_ROLES), c.send);
router.post('/:id/cancel', requireRole(...FARM_ADMIN_ROLES), c.cancel);
router.post('/:id/variations', requireRole(...FARM_ADMIN_ROLES), aiController.variations);

export default router;
