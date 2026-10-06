import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ADMIN_ROLES } from '../middleware/auth.js';
import { analyticsController as c } from '../controllers/index.js';

const router = Router();
router.get('/', verifyToken, requireRole(...FARM_ADMIN_ROLES), requireFarmAccess, c.farm);
export default router;
