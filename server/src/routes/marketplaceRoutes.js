import { Router } from 'express';
import { marketplaceController as c } from '../controllers/index.js';

// Public, read-only supply views (no minimum prices or internal notes are exposed).
const router = Router();
router.get('/supply', c.supply);
router.get('/farms', c.farms);
export default router;
