import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ROLES, FARM_ADMIN_ROLES, BUYER_ROLES } from '../middleware/auth.js';
import { rescueController as c, aiController } from '../controllers/index.js';

const router = Router();

// Public browsing of active Rescue listings.
router.get('/public', c.listPublic);

router.use(verifyToken);
router.get('/', requireRole(...FARM_ROLES), requireFarmAccess, c.list);
router.get('/price-suggestion', requireRole(...FARM_ROLES), aiController.rescuePrice);
router.post('/', requireRole(...FARM_ADMIN_ROLES), c.create);
router.patch('/:id', requireRole(...FARM_ADMIN_ROLES), c.update);
router.post('/:id/cancel', requireRole(...FARM_ADMIN_ROLES), c.cancel);
router.post('/:id/reserve', requireRole(...BUYER_ROLES), c.reserve);

export default router;
