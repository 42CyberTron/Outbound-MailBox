import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { enqueue, removeQueuedEmail } from './queue.js';
import { config } from './config.js';
import { requireInternal, requireUser } from './auth.js';
import { encrypt } from './crypto.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.webOrigin, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Authorization', 'Content-Type'] }));
app.use(express.json({ limit: '2mb' }));

const compose = z.object({
  subject: z.string().min(1).max(998).refine(value => !/[\r\n]/.test(value), 'Subject cannot contain line breaks'),
  body: z.string().min(1).max(100_000), recipients: z.array(z.string().email()).min(1).max(300),
  startAt: z.coerce.date(), delaySeconds: z.number().int().min(0).max(86_400), hourlyLimit: z.number().int().min(1).max(100),
});
const googleConnection = z.object({ ownerEmail: z.string().email(), refreshToken: z.string().min(20) });

const asyncRoute = (handler: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<unknown>) => (req: express.Request, res: express.Response, next: express.NextFunction) => { void handler(req, res, next).catch(next); };

async function validateGmailConnection(refreshToken: string) {
  if (!config.googleClientId || !config.googleClientSecret) throw new Error('Google OAuth credentials are not configured');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  const token = await tokenResponse.json() as { access_token?: string; error_description?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description ?? 'Could not validate Gmail connection');
  // Do not call users.getProfile here: it requires a broader read scope. A successful refresh
  // proves the connection, while the Google identity email is already supplied by OAuth sign-in.
}

app.get('/health', (_, res) => res.json({ ok: true }));

// Called only by the NextAuth server after Google consent. Browser clients never see refresh tokens.
app.post('/internal/gmail-connection', asyncRoute(async (req, res) => {
  if (!requireInternal(req)) return res.status(401).json({ error: 'Unauthorized' });
  const data = googleConnection.parse(req.body);
  await validateGmailConnection(data.refreshToken);
  const gmailAddress = data.ownerEmail.toLowerCase();
  await prisma.gmailMailbox.upsert({ where: { ownerEmail: data.ownerEmail.toLowerCase() }, create: { ownerEmail: data.ownerEmail.toLowerCase(), gmailAddress, encryptedRefreshToken: encrypt(data.refreshToken) }, update: { gmailAddress, encryptedRefreshToken: encrypt(data.refreshToken), revokedAt: null } });
  res.status(204).end();
}));

app.use(requireUser);

app.get('/mailbox', asyncRoute(async (_req, res) => {
  const mailbox = await prisma.gmailMailbox.findUnique({ where: { ownerEmail: res.locals.ownerEmail } });
  res.json(mailbox && !mailbox.revokedAt ? { connected: true, gmailAddress: mailbox.gmailAddress } : { connected: false });
}));

app.delete('/mailbox', asyncRoute(async (_req, res) => {
  const ownerEmail = res.locals.ownerEmail as string;
  await prisma.$transaction([
    prisma.emailJob.updateMany({ where: { ownerEmail, status: 'SCHEDULED' }, data: { status: 'FAILED', error: 'Gmail connection was removed before sending' } }),
    prisma.gmailMailbox.updateMany({ where: { ownerEmail }, data: { revokedAt: new Date(), encryptedRefreshToken: '' } }),
  ]);
  res.status(204).end();
}));

app.get('/emails', asyncRoute(async (req, res) => {
  const status = req.query.status?.toString();
  const statusFilter: Prisma.EmailJobWhereInput = status === 'SENT' ? { status: { in: ['SENT', 'FAILED'] } } : status && ['SCHEDULED', 'SENDING', 'FAILED'].includes(status) ? { status: status as 'SCHEDULED' | 'SENDING' | 'FAILED' } : {};
  res.json(await prisma.emailJob.findMany({ where: { ownerEmail: res.locals.ownerEmail, ...statusFilter }, orderBy: { scheduledAt: 'asc' } }));
}));

// Cancelling removes the database row first. A worker that already loaded the job
// then fails its conditional SCHEDULED -> SENDING claim and cannot send the email.
app.delete('/emails/:id', asyncRoute(async (req, res) => {
  const ownerEmail = res.locals.ownerEmail as string;
  const id = z.string().cuid().parse(req.params.id);
  const deleted = await prisma.emailJob.deleteMany({ where: { id, ownerEmail, status: 'SCHEDULED' } });
  if (!deleted.count) return res.status(409).json({ error: 'Only emails that are still scheduled can be cancelled' });
  await removeQueuedEmail(id);
  res.status(204).end();
}));

app.post('/emails/bulk', asyncRoute(async (req, res) => {
  const data = compose.parse(req.body); const ownerEmail = res.locals.ownerEmail as string;
  const mailbox = await prisma.gmailMailbox.findUnique({ where: { ownerEmail } });
  if (!mailbox || mailbox.revokedAt) return res.status(409).json({ error: 'Connect a Gmail account before scheduling email' });
  if (data.startAt.getTime() < Date.now() - 60_000) return res.status(400).json({ error: 'Start time must be in the future' });
  const recipients = [...new Set(data.recipients.map(value => value.toLowerCase()))];
  const interval = Math.max(data.delaySeconds * 1000, Math.ceil(3_600_000 / data.hourlyLimit)); const base = data.startAt.getTime();
  const jobs = await prisma.$transaction(recipients.map((recipient, index) => prisma.emailJob.create({ data: { ownerEmail, sender: mailbox.gmailAddress, recipient, subject: data.subject, body: data.body, hourlyLimit: data.hourlyLimit, scheduledAt: new Date(base + index * interval) } })));
  await Promise.all(jobs.map(job => enqueue(job.id, job.scheduledAt)));
  res.status(201).json({ count: jobs.length, jobs });
}));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected error'; const status = err instanceof z.ZodError ? 400 : 500;
  if (status === 500) console.error(err); res.status(status).json({ error: message });
});

app.listen(config.port, () => console.log(`API on :${config.port}`));
