import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';

type ApiClaims = { sub: string; exp: number };

function secret() {
  const value = process.env.API_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('API_AUTH_SECRET must be at least 32 characters');
  return value;
}

function signature(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function verifyApiToken(token: string): ApiClaims | null {
  const [payload, provided] = token.split('.');
  if (!payload || !provided) return null;
  const expected = signature(payload);
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ApiClaims;
    return typeof claims.sub === 'string' && claims.sub.includes('@') && Number.isFinite(claims.exp) && claims.exp > Math.floor(Date.now() / 1000) ? claims : null;
  } catch { return null; }
}

export function ownerFromRequest(req: Request) {
  const token = req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  return token ? verifyApiToken(token)?.sub ?? null : null;
}

export const requireUser: RequestHandler = (req, res, next) => {
  const ownerEmail = ownerFromRequest(req);
  if (!ownerEmail) return res.status(401).json({ error: 'Authentication required' });
  res.locals.ownerEmail = ownerEmail;
  next();
};

export function requireInternal(req: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  const provided = req.header('x-internal-api-secret');
  if (!expected || expected.length < 32 || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}
