// @vitest-environment node
// Runs the Stytch guide's verifier with real jose against locally signed tokens.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as jose from 'jose';
import { transformWithOxc } from 'vite';
import { describe, expect, it } from 'vitest';

type Verifier = (token: string, requiredScope: string) => Promise<{ allowed: boolean }>;

const ISSUER = 'https://login.example.com';
const PROJECT_ID = 'project-live-11111111-2222-3333-4444-555555555555';
const MCP_URL = 'https://mcp.example.com/mcp';

const stytchGuide = readFileSync(resolve('src/content/articles/secure-remote-mcp-server-with-stytch.md'), 'utf8');
const patternsGuide = readFileSync(resolve('src/content/articles/mcp-server-authentication-patterns.md'), 'utf8');
const verifierSource = stytchGuide
  .slice(stytchGuide.indexOf('## Step 7'))
  .match(/```typescript\n([\s\S]*?)```/)?.[1];

const keys = await jose.generateKeyPair('RS256');
const localJwks = jose.createLocalJWKSet({ keys: [{ ...(await jose.exportJWK(keys.publicKey)), kid: 'k1' }] });

async function loadVerifier(audienceEnv: string | undefined): Promise<Verifier> {
  if (!verifierSource) throw new Error('Stytch guide no longer contains the Step 7 verifier');
  const body = verifierSource.replace(/^import .*;\n/m, '').replace('export async function', 'async function');
  const { code } = await transformWithOxc(body, 'verifier.ts', { target: 'es2022' });
  const factory = new Function('createRemoteJWKSet', 'jwtVerify', 'process', `${code}\nreturn verifyAccessToken;`);
  return factory(() => localJwks, jose.jwtVerify, { env: { MCP_TOKEN_AUDIENCE: audienceEnv } }) as Verifier;
}

function token(aud: string | string[], scope = 'read:data'): Promise<string> {
  return new jose.SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);
}

describe('Stytch guide token verifier audience', () => {
  it('refuses to start without an audience or with the shared project ID', async () => {
    await expect(loadVerifier(undefined)).rejects.toThrow(/MCP_TOKEN_AUDIENCE/);
    await expect(loadVerifier('  ')).rejects.toThrow(/MCP_TOKEN_AUDIENCE/);
    await expect(loadVerifier(PROJECT_ID)).rejects.toThrow(/project ID/);
  });

  it('accepts a token carrying the MCP custom audience', async () => {
    const verify = await loadVerifier(MCP_URL);
    await expect(verify(await token([PROJECT_ID, MCP_URL]), 'read:data')).resolves.toMatchObject({ allowed: true });
  });

  it('rejects same-project tokens that do not name this MCP server', async () => {
    const verify = await loadVerifier(MCP_URL);
    // A CIMD or DCR client's token: project ID only.
    await expect(verify(await token([PROJECT_ID]), 'read:data')).rejects.toThrow(/aud/);
    // A pre-registered client of another service in the same project.
    await expect(verify(await token([PROJECT_ID, 'https://billing.example.com/api']), 'read:data')).rejects.toThrow(
      /aud/,
    );
  });
});

describe('Stytch audience guidance', () => {
  it('does not offer the project ID or project isolation as resource binding', () => {
    for (const article of [stytchGuide, patternsGuide]) {
      expect(article).not.toMatch(/if that matters/);
      expect(article).not.toMatch(/project ID for CIMD and DCR/);
      expect(article).toMatch(/authorization server[^.]*in front of Stytch/);
    }
  });
});
