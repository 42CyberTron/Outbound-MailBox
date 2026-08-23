import 'dotenv/config';
export const config = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  port: Number(process.env.API_PORT ?? 4000),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  smtp: {
  host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT ?? 465),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
},
};
