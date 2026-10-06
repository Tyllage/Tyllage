import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ROLES, FARM_ADMIN_ROLES } from '../middleware/auth.js';
import { harvestController as c, extraHarvestController as x, marketRouteController as mr } from '../controllers/index.js';

const router = Router();
router.use(verifyToken, requireRole(...FARM_ROLES));

router.get('/', requireFarmAccess, c.list);
router.post('/', requireFarmAccess, c.create);
router.get('/:id', c.get);
router.patch('/:id', c.update);
router.post('/:id/mark-available', c.markAvailable);
router.post('/:id/close', requireRole(...FARM_ADMIN_ROLES), c.close);

// MarketRoute: compare commercial routes, then select one (HarvestMatch runs within it)
router.get('/:id/routes', mr.assess);
router.post('/:id/routes/select', requireRole(...FARM_ADMIN_ROLES), mr.select);

// HarvestMatch (optionally within one route: { route })
router.post('/:id/run-matching', requireRole(...FARM_ADMIN_ROLES), c.runMatching);
router.get('/:id/matches', c.matches);

// Final disposition records: donation / alternative use / waste
router.get('/:id/dispositions', x.dispositions);
router.post('/:id/dispositions', requireRole(...FARM_ADMIN_ROLES), x.recordDisposition);

export default router;
