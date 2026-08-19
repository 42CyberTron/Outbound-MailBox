import { Queue } from 'bullmq'; import { Redis } from 'ioredis'; import { config } from './config.js';
export const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const emailQueue = new Queue('email-send', { connection });
export async function enqueue(id: string, scheduledAt: Date) {
  return emailQueue.add('send', { id }, { jobId: id, delay: Math.max(0, scheduledAt.getTime() - Date.now()), removeOnComplete: { age: 86400, count: 10000 }, removeOnFail: false, attempts: 1 });
}
