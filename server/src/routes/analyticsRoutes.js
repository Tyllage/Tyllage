import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ADMIN_ROLES } from '../middleware/auth.js';
import { analyticsController as c, extraAnalyticsController as x } from '../controllers/index.js';

const router = Router();
router.get('/', verifyToken, requireRole(...FARM_ADMIN_ROLES), requireFarmAccess, c.farm);
// Pilot success framework: baseline vs pilot result vs change.
router.get('/comparison', verifyToken, requireRole(...FARM_ADMIN_ROLES), requireFarmAccess, x.comparison);
router.put('/baselines', verifyToken, requireRole(...FARM_ADMIN_ROLES), requireFarmAccess, x.saveBaseline);
export default router;
