import type { IncomingMessage } from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ApiError } from './http/errors.js';

export interface Principal { sub: string; expiresAt: number }
export interface Authenticator {
  verify(token: string): Promise<Principal>;
  token(request: IncomingMessage): string;
  frontendOrigin: string;
  secureCookie: boolean;
}
export const sessionCookieName = 'ecoguard_session';
export function createCognitoAuth(config: { userPoolId: string; clientId: string; frontendOrigin: string }, keyResolver?: JWTVerifyGetKey): Authenticator {
  const pool = /^([a-z]{2}(?:-[a-z]+)+-\d)_[A-Za-z0-9]+$/.exec(config.userPoolId);
  if (!pool || !/^[a-zA-Z0-9]{1,128}$/.test(config.clientId)) throw new Error('Invalid Cognito pool/client configuration.');
  const origin = new URL(config.frontendOrigin);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) throw new Error('Use HTTPS outside loopback development.');
  const issuer = `https://cognito-idp.${pool[1]}.amazonaws.com/${config.userPoolId}`;
  const keys = keyResolver ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return {
    frontendOrigin: origin.origin,
    secureCookie: origin.protocol === 'https:',
    token(request) {
      const authorization = request.headers.authorization;
      if (authorization !== undefined) {
        if (!authorization.startsWith('Bearer ') || authorization.length > 16384) throw unauthorized();
        return authorization.slice(7);
      }
      const cookies = (request.headers.cookie ?? '').split(';').map(value => value.trim());
      const values = cookies.filter(cookie => cookie.startsWith(`${sessionCookieName}=`));
      if (values.length !== 1) throw unauthorized();
      const value = values[0]!.slice(sessionCookieName.length + 1);
      if (!value || value.length > 16384) throw unauthorized();
      return value;
    },
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer, algorithms: ['RS256'], clockTolerance: 5,
          requiredClaims: ['sub', 'exp', 'iat', 'token_use', 'client_id'],
        });
        if (payload.token_use !== 'access' || payload.client_id !== config.clientId ||
            !payload.sub || payload.sub.length > 128 || typeof payload.exp !== 'number' ||
            typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 5) throw unauthorized();
        return { sub: payload.sub, expiresAt: payload.exp };
      } catch { throw unauthorized(); }
    },
  };
}
function unauthorized() { return new ApiError(401, 'UNAUTHENTICATED', 'Sign in to access EcoGuard.'); }
export function checkRequestOrigin(request: IncomingMessage, auth: Authenticator) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '') && request.headers.origin && request.headers.origin !== auth.frontendOrigin) {
    throw new ApiError(403, 'INVALID_ORIGIN', 'This request must come from the EcoGuard application.');
  }
}
export function sessionCookie(token: string, expiresAt: number, secure: boolean) {
  // JWT signatures are checked before this is called. Never accept cookie syntax in token text.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw unauthorized();
  const maxAge = Math.max(0, Math.floor(expiresAt - Date.now() / 1000));
  return `${sessionCookieName}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export function clearSessionCookie(secure: boolean) {
  return `${sessionCookieName}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}
