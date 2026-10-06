import { Router } from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { userController as c } from '../controllers/index.js';

const router = Router();
router.use(verifyToken, requireRole('platform_admin'));
router.get('/', c.list);
router.patch('/:id/active', c.setActive);
export default router;
