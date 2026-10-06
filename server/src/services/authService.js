import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { validate } from '../utils/validate.js';
import { unauthorized, conflict } from '../utils/errors.js';
import { signToken, loadAuthUser } from '../middleware/auth.js';
import { BUSINESS_BUYER_TYPES, REGIONS, COLLECTION_METHODS } from '../config/rules.js';

const BCRYPT_ROUNDS = 12;

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

const registerSchema = z
  .object({
    email: z.email().max(255).transform((v) => v.trim().toLowerCase()),
    password: z.string().min(8, 'must be at least 8 characters').max(128),
    fullName: z.string().trim().min(2).max(150),
    phone: z.string().trim().max(40).optional(),
    // Self-registration is limited to buyer roles. Farm accounts are provisioned by a platform admin.
    role: z.enum(['business_buyer', 'consumer']),
    organisationName: z.string().trim().min(2).max(150).optional(),
    buyerType: z.enum(BUSINESS_BUYER_TYPES).optional(),
    region: z.enum(REGIONS).optional(),
    address: z.string().trim().max(255).optional(),
    preferredCollectionMethod: z.enum(COLLECTION_METHODS).optional(),
    whatsappOptIn: z.boolean().optional(),
  })
  .refine((d) => d.role !== 'business_buyer' || (d.organisationName && d.buyerType), {
    message: 'Business buyers must provide an organisation name and buyer type',
    path: ['organisationName'],
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});

export async function register(input) {
  const data = validate(registerSchema, input);

  const existing = await query('SELECT 1 FROM users WHERE LOWER(email) = $1', [data.email]);
  if (existing.rowCount) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');

  const passwordHash = await hashPassword(data.password);
  const userId = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [data.email, passwordHash, data.fullName, data.role, data.phone || null]
    );
    const id = rows[0].id;
    const isConsumer = data.role === 'consumer';
    await client.query(
      `INSERT INTO buyer_profiles (user_id, organisation_name, buyer_type, contact_name, contact_email, contact_phone,
                                   whatsapp_opt_in, region, address, preferred_collection_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        isConsumer ? data.fullName : data.organisationName,
        isConsumer ? 'CONSUMER' : data.buyerType,
        data.fullName,
        data.email,
        data.phone || null,
        data.whatsappOptIn ?? false,
        data.region || null,
        data.address || null,
        data.preferredCollectionMethod || 'FARM_PICKUP',
      ]
    );
    return id;
  });

  const user = await loadAuthUser(userId);
  return { token: signToken(user), user };
}

export async function login(input) {
  const { email, password } = validate(loginSchema, input);
  const { rows } = await query('SELECT id, password_hash, is_active FROM users WHERE LOWER(email) = $1', [email]);
  const row = rows[0];

  // Always run a bcrypt compare so response timing doesn't reveal whether the email exists.
  const hash = row?.password_hash || '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5X9yWnYhJ6eQ6gYxQ5x0zXzM0JjYy9u';
  const valid = await bcrypt.compare(password, hash);
  if (!row || !valid) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  if (!row.is_active) throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');

  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [row.id]);
  const user = await loadAuthUser(row.id);
  return { token: signToken(user), user };
}
