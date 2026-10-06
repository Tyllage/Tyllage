import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ROLES, FARM_ADMIN_ROLES } from '../middleware/auth.js';
import { harvestController as c } from '../controllers/index.js';

const router = Router();
router.use(verifyToken, requireRole(...FARM_ROLES));

router.get('/', requireFarmAccess, c.list);
router.post('/', requireFarmAccess, c.create);
router.get('/:id', c.get);
router.patch('/:id', c.update);
router.post('/:id/mark-available', c.markAvailable);
router.post('/:id/close', requireRole(...FARM_ADMIN_ROLES), c.close);

// HarvestMatch
router.post('/:id/run-matching', requireRole(...FARM_ADMIN_ROLES), c.runMatching);
router.get('/:id/matches', c.matches);

export default router;
