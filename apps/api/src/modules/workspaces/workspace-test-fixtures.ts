import type { RequestAuthContext } from '@nexiom/auth';

export const ORG_ID = 'org-1';
export const WS_ID = 'ws-uuid-1';
export const CONN_ID = 'conn-uuid-1';

export function makeAuth(): RequestAuthContext {
  return {
    headers: {} as unknown as Headers,
    user: { organizationId: ORG_ID } as RequestAuthContext['user'],
    session: {} as RequestAuthContext['session'],
  };
}
