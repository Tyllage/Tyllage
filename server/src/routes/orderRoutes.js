import { Router } from 'express';
import { verifyToken, farmScopeForFarmUsers, requireRole, BUYER_ROLES } from '../middleware/auth.js';
import { orderController as c, extraOrderController as x } from '../controllers/index.js';

const router = Router();
router.use(verifyToken);

router.get('/', farmScopeForFarmUsers, c.list);
// Direct / bulk orders from available supply (buyers and consumers); farm confirms.
router.post('/', requireRole(...BUYER_ROLES), x.createDirect);
router.get('/:id', c.get);
// Role/ownership rules (staff fulfil, admins/buyers cancel) are enforced in orderService.
router.patch('/:id/status', c.updateStatus);
router.post('/:id/disputes', x.raiseDispute);

export default router;

// /api/disputes — buyers see their own, farms their farm's, platform admins all and resolve.
export const disputeRoutes = Router();
disputeRoutes.use(verifyToken);
disputeRoutes.get('/', x.listDisputes);
disputeRoutes.patch('/:id', requireRole('platform_admin'), x.resolveDispute);
