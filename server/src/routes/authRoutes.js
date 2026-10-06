import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import { verifyToken } from '../middleware/auth.js';
import { authController as c } from '../controllers/index.js';

// Stricter limit on credential endpoints to slow brute-force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' },
});

const router = Router();
router.post('/register', authLimiter, c.register);
router.post('/login', authLimiter, c.login);
router.get('/me', verifyToken, c.me);
export default router;
