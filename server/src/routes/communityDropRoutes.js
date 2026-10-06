import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ROLES, FARM_ADMIN_ROLES, BUYER_ROLES } from '../middleware/auth.js';
import { communityDropController as c } from '../controllers/index.js';

const router = Router();

router.get('/upcoming', c.upcoming);

router.use(verifyToken);
router.get('/', requireRole(...FARM_ROLES), requireFarmAccess, c.list);
router.post('/', requireRole(...FARM_ADMIN_ROLES), requireFarmAccess, c.create);
router.patch('/:id/status', requireRole(...FARM_ADMIN_ROLES), c.updateStatus);
router.post('/:id/join', requireRole(...BUYER_ROLES), c.join);

export default router;
