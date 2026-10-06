import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ROLES, FARM_ADMIN_ROLES } from '../middleware/auth.js';
import { recoveryController as c } from '../controllers/index.js';

const router = Router();
router.use(verifyToken, requireRole(...FARM_ROLES));

router.get('/', requireFarmAccess, c.candidates);
router.post('/harvests/:id/start', requireRole(...FARM_ADMIN_ROLES), c.start);
router.get('/harvests/:id', c.get);

export default router;
