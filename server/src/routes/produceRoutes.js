import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ROLES, FARM_ADMIN_ROLES } from '../middleware/auth.js';
import { produceController as c } from '../controllers/index.js';

const router = Router();
router.use(verifyToken, requireRole(...FARM_ROLES));

router.get('/', requireFarmAccess, c.list);
router.post('/', requireRole(...FARM_ADMIN_ROLES), requireFarmAccess, c.create);
router.get('/:id', c.get);
router.patch('/:id', requireRole(...FARM_ADMIN_ROLES), c.update);

export default router;
