import { describe, expect, it } from 'vitest';
import { authorizationPageProblem, publicClientCache, redactExcerpt, sweepUrl } from './oauth-sweep-support';

describe('OAuth sweep evidence', () => {
  it('does not report empty pages, WAF challenges or OAuth errors as login success', () => {
    expect(authorizationPageProblem(202, 'text/html', '')?.classification).toBe('transient');
    expect(authorizationPageProblem(200, 'text/html', '<title>Just a moment</title><script src="/cdn-cgi/challenge-platform/test"></script>')?.classification).toBe('transient');
    expect(authorizationPageProblem(200, 'text/html', '<p>invalid_client</p>')?.classification).toBe('server non-compliance');
    expect(authorizationPageProblem(200, 'text/html', '<h1>Authorization failed</h1><p>Client not supported</p>')?.classification).toBe('server non-compliance');
    expect(authorizationPageProblem(200, 'application/json', '{"error":"invalid_target"}')?.classification).toBe('server non-compliance');
  });

  it('accepts login HTML even when its bundled JavaScript contains OAuth error constants', () => {
    expect(authorizationPageProblem(200, 'text/html', '<h1>Sign in to your account</h1><script>const errors = ["invalid_client"];</script>')).toBeUndefined();
    expect(authorizationPageProblem(200, 'text/html', '<h1>Log in to PayPal</h1><script src="/recaptcha.js"></script>')).toBeUndefined();
  });

  it('redacts nested credentials and hidden HTML without destroying error explanations', () => {
    const excerpt = redactExcerpt(JSON.stringify({ error: 'invalid_redirect_uri', error_description: 'Client secret required', nested: { client_id: 'private-client', access_token: 'private-token' }, detail: 'https://auth.example/error?state=private-state' }));
    expect(excerpt).toContain('Client secret required');
    for (const secret of ['private-client', 'private-token', 'private-state']) expect(excerpt).not.toContain(secret);
    expect(redactExcerpt('<h1>Invalid callback</h1><input value="private-state"><script>secret="private-secret"</script>')).toBe('Invalid callback');
    expect(redactExcerpt('Invalid response. Raw body: {"client_secret":"private-secret","access_token":"private-token"}')).not.toContain('private-');
    expect(sweepUrl('https://auth.example/interaction/abcdefghijklmnopqrstuvwxyz012345?state=private-state'))
      .not.toContain('abcdefghijklmnopqrstuvwxyz012345');
  });

  it('persists only public issuer-bound client IDs, dropping tokens and all extra registration fields', () => {
    const key = 'mcp_oauth_v2:https://mcp.example/';
    const cache = publicClientCache({ trace: 'private-trace', [key]: JSON.stringify({
      tokens: { access_token: 'private-token' }, codeVerifier: 'private-verifier', clients: {
        'https://auth.example': { client_id: 'public-client', issuer: 'https://auth.example', token_endpoint_auth_method: 'none', registration_access_token: 'private-registration-token' },
        'https://other.example': { client_id: 'confidential-client', issuer: 'https://other.example', client_secret: 'private-secret' },
      },
    }) });
    expect(JSON.parse(cache[key])).toEqual({ clients: { 'https://auth.example': { client_id: 'public-client', issuer: 'https://auth.example', token_endpoint_auth_method: 'none' } } });
    expect(JSON.stringify(cache)).not.toContain('private');
  });
});
