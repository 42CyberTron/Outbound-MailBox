import 'dotenv/config';
export const config = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
};
