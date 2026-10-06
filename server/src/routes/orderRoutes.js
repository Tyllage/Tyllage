import { Router } from 'express';
import { verifyToken, farmScopeForFarmUsers } from '../middleware/auth.js';
import { orderController as c } from '../controllers/index.js';

const router = Router();
router.use(verifyToken);

router.get('/', farmScopeForFarmUsers, c.list);
router.get('/:id', c.get);
// Role/ownership rules (staff fulfil, admins/buyers cancel) are enforced in orderService.
router.patch('/:id/status', c.updateStatus);

export default router;
