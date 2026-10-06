import { Router } from 'express';
import { verifyToken, farmScopeForFarmUsers, requireRole, FARM_ADMIN_ROLES, BUYER_ROLES } from '../middleware/auth.js';
import { demandController as c } from '../controllers/index.js';

const router = Router();
router.use(verifyToken);

// Farm users: ?farmId=… (demand directed to the farm + open marketplace demand). Buyers: their own demand.
router.get('/', farmScopeForFarmUsers, c.list);
router.post('/', requireRole(...FARM_ADMIN_ROLES, 'farm_staff', ...BUYER_ROLES), c.create);
router.get('/:id', c.get);
router.patch('/:id', c.update);
router.post('/:id/cancel', c.cancel);

export default router;
