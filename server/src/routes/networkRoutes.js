import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ROLES, FARM_ADMIN_ROLES } from '../middleware/auth.js';
import { poolController as c } from '../controllers/index.js';

// FarmPool (many farms → one large buyer) and DemandPool (many buyers → one viable farm order).
export const farmPoolRoutes = Router();
farmPoolRoutes.use(verifyToken, requireRole(...FARM_ROLES));
farmPoolRoutes.get('/', requireFarmAccess, c.farmPool);
farmPoolRoutes.post('/:demandId/contribute', requireRole(...FARM_ADMIN_ROLES), c.contribute);

export const demandPoolRoutes = Router();
demandPoolRoutes.use(verifyToken, requireRole(...FARM_ROLES));
demandPoolRoutes.get('/', requireFarmAccess, c.demandPools);
demandPoolRoutes.get('/suggestions', requireFarmAccess, c.demandPoolSuggestions);
demandPoolRoutes.post('/', requireRole(...FARM_ADMIN_ROLES), c.createDemandPool);
