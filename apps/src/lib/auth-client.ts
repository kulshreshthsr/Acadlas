// The browser's half of the shared Acadlas authentication. Every product in the
// ecosystem talks to the same platform API, so this file is the one place that
// knows where that API lives.
//
// The organization plugin mirrors the backend's: a school is an organization, and
// the session carries whichever school the person is currently working in.
import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';

// Set VITE_API_URL when the API is not on localhost (a deployed Worker, a
// teammate's machine). See .env.local.example.
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

export const authClient = createAuthClient({
  baseURL: apiUrl,
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession, organization } = authClient;

// Better Auth returns errors rather than throwing them, and its messages are
// written for developers. These are the ones a school administrator can actually
// act on; anything unmapped falls through to the server's own message.
const friendlyMessages: Record<string, string> = {
  USER_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead.',
  INVALID_EMAIL_OR_PASSWORD: 'That email and password do not match an account.',
  INVALID_EMAIL: 'Enter a valid email address.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters.',
  ORGANIZATION_ALREADY_EXISTS: 'A school with this short name already exists. Try another.',
  SLUG_IS_TAKEN: 'That short name is taken. Try another.',
};

type AuthError = {
  code?: string;
  message?: string;
  status?: number;
} | null;

/**
 * Turns whatever came back from the API into one sentence worth showing someone.
 * Covers the case where the request never reached the server at all, which during
 * development usually means the API is not running.
 */
export function describeAuthError(error: AuthError): string {
  if (!error) {
    return 'Something went wrong. Try again.';
  }

  if (error.code && friendlyMessages[error.code]) {
    return friendlyMessages[error.code];
  }

  if (error.status === 0 || error.message === 'Failed to fetch') {
    return `Cannot reach the Acadlas API at ${apiUrl}. Start it with "npm run dev" in the platform folder.`;
  }

  return error.message ?? 'Something went wrong. Try again.';
}

export { apiUrl };
