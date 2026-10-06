import { Router } from 'express';
import { verifyToken, requireRole, requireFarmAccess, FARM_ROLES } from '../middleware/auth.js';
import { aiController as c } from '../controllers/index.js';

// AI assistant: explanations and summaries only (simulated when no OpenAI key is configured).
const router = Router();
router.use(verifyToken, requireRole(...FARM_ROLES));
router.get('/status', c.status);
router.post('/matches/:id/explain', c.explainMatch);
router.post('/insights', requireFarmAccess, c.insights);
export default router;
