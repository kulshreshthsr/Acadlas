// The browser's half of the shared Acadlas authentication. Every product in the
// ecosystem talks to the same platform API, so this file is the one place that
// knows where that API lives.
//
// The organization plugin mirrors the backend's: a school is an organization, and
// the session carries whichever school the person is currently working in.
import { createAuthClient } from 'better-auth/react';
import { organizationClient, phoneNumberClient } from 'better-auth/client/plugins';

// Set VITE_API_URL when the API is not on localhost (a deployed Worker, a
// teammate's machine). See .env.local.example. "same-origin" means the host serving this
// app forwards /api/* to the API (see ../../functions), so sign-in cookies stay first-party.
const configured = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
const apiUrl = configured === 'same-origin' ? window.location.origin : configured;

export const authClient = createAuthClient({
  baseURL: apiUrl,
  plugins: [organizationClient(), phoneNumberClient()],
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
  INVALID_TOKEN: 'This link has expired or was already used. Ask for a new one.',
  INVITATION_NOT_FOUND: 'This invitation no longer exists. Ask the school for a new one.',
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: 'This invitation was sent to a different email address.',
  INVALID_PHONE_NUMBER_OR_PASSWORD: 'That phone number and password do not match a parent account.',
  INVALID_PHONE_NUMBER: 'Enter a 10-digit Indian mobile number.',
  RATE_LIMITED: 'Too many tries. Wait a little and try again.',
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

  // Sign-in limits (the API's own, and Better Auth's) both answer 429.
  if (error.status === 429) {
    return 'Too many tries for now. Wait a few minutes and try again.';
  }

  if (error.status === 0 || error.message === 'Failed to fetch') {
    return `Cannot reach the Acadlas API at ${apiUrl}. Start it with "npm run dev" in the platform folder.`;
  }

  return error.message ?? 'Something went wrong. Try again.';
}

/**
 * Better Auth returns an error object when the server answers and refuses, but it
 * throws when the request never gets an answer at all — API not running, connection
 * dropped, DNS gone. Both have to be handled or a failed submit leaves the button
 * spinning forever with nothing said.
 */
export function describeThrownError(thrown: unknown): string {
  const message = thrown instanceof Error ? thrown.message : undefined;
  return describeAuthError({ status: 0, message });
}

export { apiUrl };

/**
 * Parents sign in with a phone number; staff with an email. A session tells them apart by
 * whether the account has a phone number (only parent accounts can — see the platform's
 * src/parent/). Each side of the app sends the other kind of person to their own side.
 */
export function isParentSession(session: { user: unknown } | null | undefined): boolean {
  return Boolean((session?.user as { phoneNumber?: string | null } | undefined)?.phoneNumber);
}

/** "98765 43210", "+91 98765-43210", "09876543210" → "+919876543210", or null if it is not a mobile number. */
export function toLoginPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}
