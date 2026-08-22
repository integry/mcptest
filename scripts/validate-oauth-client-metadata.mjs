import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const documentUrl = 'https://mcptest.io/oauth/client-metadata.json';
const callbackUrl = 'https://mcptest.io/oauth/callback';
const metadata = JSON.parse(await readFile(
  new URL('../public/oauth/client-metadata.json', import.meta.url),
  'utf8'
));

assert.deepEqual(metadata, {
  client_id: documentUrl,
  client_name: 'mcptest.io MCP Inspector',
  client_uri: 'https://mcptest.io/',
  logo_uri: 'https://mcptest.io/logo.png',
  redirect_uris: [callbackUrl],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  application_type: 'web',
}, 'public OAuth Client ID Metadata Document does not match the hosted runtime contract');

const parsedDocumentUrl = new URL(metadata.client_id);
assert.equal(parsedDocumentUrl.protocol, 'https:');
assert.notEqual(parsedDocumentUrl.pathname, '/');
assert.equal(metadata.client_id, documentUrl);
assert.equal(metadata.redirect_uris[0], callbackUrl);
