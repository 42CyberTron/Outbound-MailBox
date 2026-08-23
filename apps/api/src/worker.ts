import { DelayedError, Worker } from 'bullmq';
import { prisma } from './db.js';
import { connection } from './queue.js';
import { reserveSender } from './rateLimit.js';
import { config } from './config.js';
import { decrypt } from './crypto.js';

const minDelay = Number(process.env.MIN_SEND_DELAY_MS ?? 6_000);
const senderHourlyLimit = Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? 20);
const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

async function gmailAccessToken(refreshToken: string) {
  if (!config.googleClientId || !config.googleClientSecret) throw new Error('Google OAuth credentials are not configured');
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  const data = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description ?? data.error ?? 'Could not refresh Gmail access');
  return data.access_token;
}

function rawMessage(from: string, to: string, subject: string, body: string) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const encodedBody = Buffer.from(body, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return base64url(`From: ${from}\r\nTo: ${to}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`);
}

async function sendWithGmail(refreshToken: string, from: string, to: string, subject: string, body: string) {
  const accessToken = await gmailAccessToken(refreshToken);
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw: rawMessage(from, to, subject, body) }) });
  if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: { message?: string } }; throw new Error(data.error?.message ?? `Gmail rejected the message (${response.status})`); }
}

new Worker('email-send', async job => {
  const row = await prisma.emailJob.findUnique({ where: { id: job.data.id } });
  if (!row || row.status === 'SENT' || row.status === 'FAILED') return;
  const eligible = await reserveSender(row.sender, senderHourlyLimit, minDelay);
  if (eligible > Date.now() + 20) { await prisma.emailJob.update({ where: { id: row.id }, data: { scheduledAt: new Date(eligible) } }); await job.moveToDelayed(eligible, job.token); throw new DelayedError(); }
  const claimed = await prisma.emailJob.updateMany({ where: { id: row.id, status: 'SCHEDULED' }, data: { status: 'SENDING', attempts: { increment: 1 } } });
  if (!claimed.count) return;
  try {
    const mailbox = await prisma.gmailMailbox.findUnique({ where: { ownerEmail: row.ownerEmail } });
    if (!mailbox || mailbox.revokedAt || !mailbox.encryptedRefreshToken) throw new Error('Gmail connection is no longer available');
    if (mailbox.gmailAddress !== row.sender) throw new Error('Gmail sender no longer matches the scheduled message');
    await sendWithGmail(decrypt(mailbox.encryptedRefreshToken), row.sender, row.recipient, row.subject, row.body);
    await prisma.emailJob.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email delivery failed'; await prisma.emailJob.update({ where: { id: row.id }, data: { status: 'FAILED', error: message } }); throw error;
  }
}, { connection, concurrency: config.concurrency });

console.log(`Gmail worker running (concurrency ${config.concurrency})`);
