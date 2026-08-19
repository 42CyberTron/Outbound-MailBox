import 'dotenv/config';
export const config = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  port: Number(process.env.API_PORT ?? 4000),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  smtp: { host: process.env.SMTP_HOST ?? 'smtp.ethereal.email', port: Number(process.env.SMTP_PORT ?? 587), auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
};
