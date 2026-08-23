import { createHmac } from 'node:crypto';
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

function apiToken(email: string) {
  const secret = process.env.API_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('API_AUTH_SECRET must be at least 32 characters');
  const payload = Buffer.from(JSON.stringify({ sub: email.toLowerCase(), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8 })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

const handler = NextAuth({
  providers: [GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    authorization: { params: { scope: 'openid email profile https://www.googleapis.com/auth/gmail.send', access_type: 'offline', prompt: 'consent' } },
  })],
  callbacks: {
    async signIn({ user, account }) {
      // Google sends the refresh token directly server-to-server. It is never exposed to the browser.
      if (account?.provider === 'google' && account.refresh_token && user.email) {
        const url = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
        const secret = process.env.INTERNAL_API_SECRET;
        if (!url || !secret) return false;
        const response = await fetch(`${url}/internal/gmail-connection`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-api-secret': secret }, body: JSON.stringify({ ownerEmail: user.email, refreshToken: account.refresh_token }) });
        if (!response.ok) { console.error('Could not store Gmail connection', response.status); return false; }
      }
      return true;
    },
    async jwt({ token }) { if (token.email) token.apiToken = apiToken(token.email); return token; },
    async session({ session, token }) { (session as typeof session & { apiToken?: string }).apiToken = token.apiToken as string | undefined; return session; },
  },
});

export { handler as GET, handler as POST };
