import { beforeEach, expect, it, vi } from 'vitest';
import type { FetchLike } from '@modelcontextprotocol/client';
import { beginOAuthFlow, getOAuthPrerequisite } from './oauthFlow';
import resource from './fixtures/oauth-sweep/github-resource.json';
import issuer from './fixtures/oauth-sweep/github-issuer.json';
import { getOAuthProviderPolicy } from './oauthProviderPolicy';
import dropboxResource from './fixtures/oauth-sweep/dropbox-resource.json';
import dropboxIssuer from './fixtures/oauth-sweep/dropbox-issuer.json';
import dropboxRegistration from './fixtures/oauth-sweep/dropbox-registration.json';
import harnessResource from './fixtures/oauth-sweep/harness-resource.json';
import harnessIssuer from './fixtures/oauth-sweep/harness-issuer.json';
import harnessRegistration from './fixtures/oauth-sweep/harness-registration.json';
import similarwebResource from './fixtures/oauth-sweep/similarweb-resource.json';
import similarwebMetadataError from './fixtures/oauth-sweep/similarweb-metadata-error.json';
import zoominfoRegistration from './fixtures/oauth-sweep/zoominfo-registration.json';

// Recorded from public GitHub discovery endpoints on 2026-10-25. No credentials.
beforeEach(() => sessionStorage.clear());

it('recognizes GitHub catalog /mcp and gives operator setup guidance instead of a public client form', async () => {
  const redirect = vi.fn();
  const fetchFn: FetchLike = async input => {
    const url = String(input);
    const body = url === 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp'
      ? resource : url === 'https://github.com/.well-known/oauth-authorization-server/login/oauth'
        ? issuer : undefined;
    if (!body) throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  const error = await beginOAuthFlow(resource.resource, { fetchFn, redirect })
    .catch(error => error);
  expect(getOAuthPrerequisite(error)).toMatchObject({
    kind: 'pre_registered_client_required', providerName: 'GitHub',
    configurationMode: 'operator-confidential', canConfigureClient: false,
    supportsBearerToken: true, bearerTokenName: 'GitHub personal access token',
  });
  expect(redirect).not.toHaveBeenCalled();
});

it('keeps GitHub trust restricted to explicit target aliases and the recorded issuer', () => {
  for (const target of [resource.resource, `${resource.resource}/`]) {
    expect(getOAuthProviderPolicy(target, issuer.issuer)?.id).toBe('github');
    expect(getOAuthProviderPolicy(target, `${issuer.issuer}/other`)).toBeUndefined();
  }
  for (const target of [`${resource.resource}/other`, `${resource.resource}?tenant=other`, 'https://api.githubcopilot.com.evil.example/mcp']) {
    expect(getOAuthProviderPolicy(target, issuer.issuer)).toBeUndefined();
  }
});

it('explains Dropbox trusted-partner registration rejection instead of recommending another registration attempt', async () => {
  let posts = 0;
  const fetchFn: FetchLike = async (input, init) => {
    const url = String(input);
    let body: unknown;
    if (url === 'https://mcp.dropbox.com/.well-known/oauth-protected-resource/mcp') body = dropboxResource;
    else if (url === 'https://www.dropbox.com/.well-known/oauth-authorization-server') body = dropboxIssuer;
    else if (url === dropboxIssuer.registration_endpoint && init?.method === 'POST') {
      posts++;
      return new Response(JSON.stringify(dropboxRegistration), { status: 403 });
    } else throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  const error = await beginOAuthFlow(dropboxResource.resource, { fetchFn, redirect: vi.fn() }).catch(error => error);
  expect(getOAuthPrerequisite(error)).toMatchObject({
    kind: 'provider_approval_required', canConfigureClient: false, httpStatus: 403,
    explanation: expect.stringContaining('Provider approval or allow-list access is required'),
  });
  expect(posts).toBe(1);
});

it('explains Harness trusted-host policy rejection after OIDC issuer-path fallback', async () => {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push(url);
    let body: unknown;
    if (url === 'https://mcp.harness.io/.well-known/oauth-protected-resource/mcp') body = harnessResource;
    else if (url === `${harnessIssuer.issuer}/.well-known/openid-configuration`) body = harnessIssuer;
    else if (url === harnessIssuer.registration_endpoint && init?.method === 'POST') {
      return new Response(JSON.stringify(harnessRegistration), { status: 403 });
    } else if (url.startsWith('https://id.harness.io/.well-known/')) return new Response('', { status: 403 });
    else throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  const error = await beginOAuthFlow(harnessResource.resource, { fetchFn, redirect: vi.fn() }).catch(error => error);
  expect(getOAuthPrerequisite(error)).toMatchObject({
    kind: 'provider_approval_required', canConfigureClient: false, httpStatus: 403,
  });
  expect(calls).toContain(`${harnessIssuer.issuer}/.well-known/openid-configuration`);
});

it('recognizes the recorded ZoomInfo approved-vendor rejection as provider approval', async () => {
  const target = 'https://mcp.zoominfo.com/mcp';
  const fetchFn: FetchLike = async (input, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify(zoominfoRegistration), { status: 400 });
    const body = String(input).includes('oauth-protected-resource')
      ? { resource: target, authorization_servers: ['https://mcp.zoominfo.com'] }
      : { issuer: 'https://mcp.zoominfo.com', authorization_endpoint: 'https://mcp.zoominfo.com/authorize', token_endpoint: 'https://mcp.zoominfo.com/token', registration_endpoint: 'https://mcp.zoominfo.com/oauth/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] };
    return new Response(JSON.stringify(body));
  };
  const error = await beginOAuthFlow(target, { fetchFn, redirect: vi.fn() }).catch(error => error);
  expect(getOAuthPrerequisite(error)).toMatchObject({ kind: 'provider_approval_required', canConfigureClient: false, httpStatus: 400 });
});

it.each([401, similarwebMetadataError.status])('does not infer absent metadata or offer manual endpoint overrides from HTTP %s access denial', async status => {
  const fetchFn: FetchLike = async input => {
    if (String(input).includes('oauth-protected-resource')) return new Response(JSON.stringify(similarwebResource));
    return new Response(similarwebMetadataError.body, { status });
  };
  const error = await beginOAuthFlow(similarwebResource.resource, { fetchFn, redirect: vi.fn() }).catch(error => error);
  expect(getOAuthPrerequisite(error)).toMatchObject({
    kind: 'discovery_blocked_invalid', canConfigureClient: false,
    explanation: expect.stringContaining('does not prove that metadata is missing'),
  });
});
