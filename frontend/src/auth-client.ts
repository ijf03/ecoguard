import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { ApiError, setMediaTransport, setCloudUploads } from './api/media';
import { createSessionCoordinator } from './session-coordinator';

setCloudUploads(import.meta.env.VITE_CLOUD_UPLOADS === 'true');

const sessions = createSessionCoordinator<string | undefined>();
const storagePrefix = 'ecoguard.auth.';

export const localDevelopment = import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEV === 'true';
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
export const authConfigured = Boolean(userPoolId && userPoolClientId);
if (authConfigured && !localDevelopment) {
  Amplify.configure({ Auth: { Cognito: { userPoolId: userPoolId!, userPoolClientId: userPoolClientId!, loginWith: { email: true } } } });
  cognitoUserPoolsTokenProvider.setKeyValueStorage({
    getItem: async key => sessionStorage.getItem(storagePrefix + key),
    setItem: async (key, value) => { sessionStorage.setItem(storagePrefix + key, value); },
    removeItem: async key => { sessionStorage.removeItem(storagePrefix + key); },
    clear: async () => {
      const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
      for (const key of keys) if (key?.startsWith(storagePrefix)) sessionStorage.removeItem(key);
    },
  });
  setMediaTransport(async (path, options) => {
    if (!path.startsWith('/api/')) throw new Error('Authenticated requests must use the same-origin EcoGuard API.');
    const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
    const headers = new Headers(options?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(path, { ...options, headers });
    if (response.status === 401) window.dispatchEvent(new Event('ecoguard:session-expired'));
    return response;
  });
}
export function resumeBackendSession() { sessions.resume(); }
export function syncBackendSession() { return sessions.run(refreshBackendSession); }
async function refreshBackendSession() {
  let session = await fetchAuthSession();
  if (!session.tokens?.accessToken) return undefined;
  const expiry = Number(session.tokens.accessToken.payload.exp);
  if (expiry - Date.now() / 1000 < 120) session = await fetchAuthSession({ forceRefresh: true });
  const token = session.tokens?.accessToken?.toString();
  if (!token) return undefined;
  // HttpOnly same-origin session authorizes native image/video requests as well as fetch.
  const response = await fetch('/api/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('We could not open a secure application session. Please try again.');
  const name = session.tokens?.idToken?.payload.given_name;
  return typeof name === 'string' && name ? name : 'EcoGuard member';
}
export async function endAuthenticatedSession() {
  await sessions.end(async () => {
    const response = await fetch('/api/auth/session', { method: 'DELETE', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Could not clear the application session. Please retry signing out.');
    await signOut();
  });
}
