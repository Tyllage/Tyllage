import { Router } from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { adminController as c } from '../controllers/index.js';

// Platform administration: business-rule policies and the platform-wide audit trail.
const router = Router();
router.use(verifyToken, requireRole('platform_admin'));
router.get('/policies', c.policies);
router.patch('/policies', c.updatePolicies);
router.get('/audit-logs', c.auditLogs);
export default router;
