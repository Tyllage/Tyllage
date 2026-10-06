import { Router } from 'express';
import { marketplaceController as c, farmProfileController } from '../controllers/index.js';

// Public, read-only supply views (no minimum prices, costs or internal notes are exposed).
const router = Router();
router.get('/supply', c.supply);
router.get('/farms', c.farms);
router.get('/farms/:id', farmProfileController.get);
export default router;
