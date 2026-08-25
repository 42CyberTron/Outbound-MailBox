# Mail Scheduler

An email scheduling service built for a ReachInbox-style take-home. The API stores each send as a PostgreSQL row; BullMQ is the durable scheduling/dispatch layer. The dashboard uses real Google OAuth via NextAuth.

## Quick start

1. Copy `.env.example` to `.env`, then set the Google OAuth credentials and the security secrets below. Add `http://localhost:3000/api/auth/callback/google` as the Google callback URL and enable the Gmail API in the same Google Cloud project.
2. Start infrastructure: `docker compose up -d`.
3. Install packages: `npm install`.
4. Generate/migrate the database: `npm --workspace @reach/api run prisma:generate` then `npm --workspace @reach/api run prisma:migrate`.
5. In separate terminals run `npm run dev:api`, `npm run worker`, and `npm run dev:web`. Open `http://localhost:3000`.

Run `npm run reconcile` before each worker deployment/startup. A production process manager should execute that command and only then start the worker.

## Gmail connection setup

Each user connects their own Gmail account through Google OAuth. The app requests only the `gmail.send` scope, stores the resulting refresh token encrypted with AES-256-GCM, and uses it only in the background worker at the scheduled time. It never requests or stores a Gmail password or App Password.

Generate the three application secrets before first run:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- `TOKEN_ENCRYPTION_KEY` must be a base64-encoded 32-byte value from that command. It encrypts Gmail refresh tokens at rest.
- `API_AUTH_SECRET` and `INTERNAL_API_SECRET` must be different random values of at least 32 characters. The first signs browser-to-API requests; the second protects the server-to-server OAuth callback.

For local development, add the Next.js variables to `apps/web/.env.local`:

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
API_AUTH_SECRET=the-same-api-auth-secret-as-the-api
INTERNAL_API_URL=http://localhost:4000
INTERNAL_API_SECRET=the-same-internal-api-secret-as-the-api
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Keep `DATABASE_URL`, `REDIS_URL`, the Google OAuth credentials, `API_AUTH_SECRET`, `INTERNAL_API_SECRET`, `TOKEN_ENCRYPTION_KEY`, and `WEB_ORIGIN=http://localhost:3000` in the API/worker environment. Never commit either environment file.

## Implemented features

### Backend

- Express TypeScript API with `/health`, bulk scheduling, and email listing endpoints.
- PostgreSQL persistence through Prisma, with one durable `EmailJob` row per recipient.
- BullMQ delayed scheduling with `jobId` equal to the PostgreSQL row ID for idempotency.
- Configurable worker concurrency through `WORKER_CONCURRENCY`.
- Per-sender minimum delay through `MIN_SEND_DELAY_MS`.
- Per-sender hourly limit through `MAX_EMAILS_PER_HOUR_PER_SENDER`.
- Atomic Redis Lua rate-limit reservations safe across multiple workers.
- Rate-limited jobs are delayed until the next eligible time and are never dropped.
- Redis AOF persistence through Docker Compose.
- Startup reconciliation command that restores missing queue jobs from scheduled database rows.
- Per-user Gmail API delivery with encrypted refresh-token storage and `SENT`/`FAILED` status tracking.

### Frontend

- Next.js and TypeScript application styled with Tailwind CSS.
- Real Google OAuth login through NextAuth.
- Header with authenticated user name, email, avatar, and logout.
- Scheduled and Sent email views with loading and empty states.
- Reference-style mailbox layout with sidebar navigation and email detail view.
- Compose screen with sender, subject, body, start time, delay, and hourly limit controls.
- CSV upload or pasted recipient list with live valid-address counting and deduplication.
- API integration for creating campaigns and refreshing job status.

## Architecture and guarantees

![alt text](image.png)

`Next.js dashboard → Express API → PostgreSQL (source of truth) → BullMQ delayed job → worker → Gmail API`.

- A job is first persisted in Postgres, then queued with `jobId` exactly equal to the database row ID. BullMQ's uniqueness check makes repeated enqueue calls idempotent.
- CSV recipients are normalized/deduplicated client-side and persisted in one transaction. The API derives a spacing interval of `max(user delay, 1 hour / hourly limit)`, so campaigns are staggered and initially avoid hourly overflow.
- The worker has `WORKER_CONCURRENCY` (default 5). `MAX_EMAILS_PER_HOUR_PER_SENDER` (default 100) is the single enforced limit for each sender, even when that sender has multiple campaigns. `MIN_SEND_DELAY_MS` (default 1000) controls the inter-send gap. A Redis Lua script atomically checks/reserves both limits and remains correct with many worker replicas. If no slot is available, the active BullMQ job is moved back to delayed state at the next eligible timestamp; it is never discarded.
- Redis runs AOF (`appendonly yes`, `appendfsync everysec`) on a persistent Docker volume. The reconciliation command scans scheduled DB rows and re-adds only those whose queue job is missing. This covers queue loss/restart without duplicate scheduling.

### Delivery caveat

The database state transition prevents duplicate *queue processing*. A process crash after Gmail accepts a message but before the database acknowledgement is committed can still result in an uncertain outcome. Production systems address that edge with a provider-side idempotency key or an outbox provider. This implementation records each delivery attempt and uses persistent queue/database recovery for all other restart paths.

## Production deployment notes

Use managed PostgreSQL and Redis with AOF/replication, run reconciliation as a release/startup hook, set the sender limit and `MIN_SEND_DELAY_MS` to provider policy, configure `WEB_ORIGIN` to the exact dashboard URL, and keep all token-encryption and API-authentication secrets in your host's secret manager.
