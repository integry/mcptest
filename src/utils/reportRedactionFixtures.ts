/**
 * Credential-bearing inputs the app's report redaction must neutralize, drawn
 * from the cases exercised in `reportArtifact.test.ts`: plain and quoted
 * assignments, authorization and cookie headers, Bearer/Basic credentials, JWTs,
 * URL parameters and encoded path components, JSON-shaped strings, JSON-encoded
 * string literals, JSON fragments embedded in surrounding text, escaped
 * separators and structured sensitive keys.
 *
 * Each fixture names the exact secret substrings that must not survive
 * redaction. The Worker runs the same corpus through its port of the redaction
 * and its detection guard (cloudflare-worker/src), so the two implementations
 * cannot drift apart silently.
 */

export interface ReportRedactionFixture {
  readonly name: string;
  /** A string the app redacts with `redactReportString`. */
  readonly value: string;
  /** Substrings that must not survive redaction. */
  readonly secrets: readonly string[];
}

export interface ReportRedactionValueFixture {
  readonly name: string;
  /** A JSON value the app redacts with `redactReportValue`. */
  readonly value: Record<string, unknown>;
  /** Substrings that must not survive redaction. */
  readonly secrets: readonly string[];
}

export const FIXTURE_JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUgRG9lIn0',
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
].join('.');

const encodeTimes = (value: string, times: number): string => (
  Array.from({ length: times }).reduce<string>((text) => JSON.stringify(text), value)
);

const uriEncodeTimes = (value: string, times: number): string => (
  Array.from({ length: times }).reduce<string>((text) => encodeURIComponent(text), value)
);

export const REPORT_REDACTION_STRING_FIXTURES: readonly ReportRedactionFixture[] = [
  {
    name: 'OAuth credential parameters in plain-text assignments',
    value: 'id_token_hint=plain-id-secret client-assertion=plain-assertion-secret deviceCode=plain-device-secret user_code=plain-user-secret',
    secrets: ['plain-id-secret', 'plain-assertion-secret', 'plain-device-secret', 'plain-user-secret'],
  },
  {
    name: 'punctuation- and whitespace-separated assignment keys',
    value: 'api.key=punctuation-api-secret\nAPI Key: whitespace-api-secret\nprivate key=private-key-secret\ncode verifier: verifier-secret',
    secrets: ['punctuation-api-secret', 'whitespace-api-secret', 'private-key-secret', 'verifier-secret'],
  },
  {
    name: 'compound and form-encoded secret names',
    value: 'secret_key=compound-secret-value token_value=compound-token-value x-amz-signature=compound-signature-value access%5Ftoken=encoded-form-token-value',
    secrets: ['compound-secret-value', 'compound-token-value', 'compound-signature-value', 'encoded-form-token-value'],
  },
  {
    name: 'compound credential-family keys in text and URLs',
    value: 'apiKeyValue=plain-api-key-secret https://example.test/?api_key_value=url-api-key-secret&api_key_supported=true',
    secrets: ['plain-api-key-secret', 'url-api-key-secret'],
  },
  {
    name: 'a standalone JWT',
    value: `Rejected JWT ${FIXTURE_JWT}`,
    secrets: [FIXTURE_JWT],
  },
  {
    name: 'a JWT query parameter',
    value: 'https://example.test/?jwt=url-jwt-secret&visible=yes',
    secrets: ['url-jwt-secret'],
  },
  {
    name: 'a JSON-shaped string',
    value: '{"access_token":"json-report-secret"}',
    secrets: ['json-report-secret'],
  },
  {
    name: 'a complete Authorization header',
    value: 'Authorization: ApiKey authorization-report-secret',
    secrets: ['authorization-report-secret'],
  },
  {
    name: 'a complete Cookie header',
    value: 'Cookie: a=cookie-one-secret; b=cookie-two-secret',
    secrets: ['cookie-one-secret', 'cookie-two-secret'],
  },
  {
    name: 'a Cookie assignment',
    value: 'Cookie=a=equals-cookie-one-secret; b=equals-cookie-two-secret',
    secrets: ['equals-cookie-one-secret', 'equals-cookie-two-secret'],
  },
  {
    name: 'backslash-escaped JSON inside a quoted body',
    value: String.raw`body="{\"access_token\":\"escaped-json-secret\"}"`,
    secrets: ['escaped-json-secret'],
  },
  {
    name: 'a backslash-escaped JSON object',
    value: String.raw`{\"client_secret\":\"escaped-object-secret\"}`,
    secrets: ['escaped-object-secret'],
  },
  {
    name: 'JSON encoded past the decode bound',
    value: encodeTimes('{"access_token":"over-bound-json-secret"}', 6),
    secrets: ['over-bound-json-secret'],
  },
  {
    name: 'an array value for a sensitive key',
    value: '{"access_token":["array-report-secret"]}',
    secrets: ['array-report-secret'],
  },
  {
    name: 'an object value for a sensitive key',
    value: '{"credentials":{"password":"object-report-secret"}}',
    secrets: ['object-report-secret'],
  },
  {
    name: 'a credential object embedded in surrounding text',
    value: 'error body: {"credentials":{"value":"embedded-object-secret"}} after response',
    secrets: ['embedded-object-secret'],
  },
  {
    name: 'a credential array embedded in surrounding text',
    value: 'error body: {"credentials":[{"value":"embedded-array-secret"}]} after response',
    secrets: ['embedded-array-secret'],
  },
  {
    name: 'decoded sensitive keys in an embedded fragment',
    value: String.raw`error body: {"access token":"space-key-secret","api.key":"punctuation-key-secret","access token":"escaped-key-secret"} after response`,
    secrets: ['space-key-secret', 'punctuation-key-secret', 'escaped-key-secret'],
  },
  {
    name: 'a sensitive key in a JSON-escaped fragment',
    value: String.raw`error body: {\"oauth credential\":\"escaped-fragment-secret\"} after response`,
    secrets: ['escaped-fragment-secret'],
  },
  {
    name: 'a bearer credential with an escaped separator inside a prefixed fragment',
    value: String.raw`response: {"note":"Bearer example-access-token"}`,
    secrets: ['example-access-token'],
  },
  {
    name: 'a bearer credential with an escaped separator in a JSON-encoded string',
    value: String.raw`"Bearer escaped-separator-secret"`,
    secrets: ['escaped-separator-secret'],
  },
  {
    name: 'an apostrophe inside an assignment value',
    value: "password=apostrophe'secret-suffix",
    secrets: ["apostrophe'secret-suffix"],
  },
  {
    name: 'a quote inside an assignment value',
    value: 'client_secret=quote"secret-suffix',
    secrets: ['quote"secret-suffix'],
  },
  {
    name: 'an apostrophe inside a URL credential',
    value: "https://client.example/callback?access_token=url-apostrophe'secret-suffix&visible=yes",
    secrets: ["url-apostrophe'secret-suffix", 'secret-suffix'],
  },
  {
    name: 'a quote inside a URL credential',
    value: 'https://client.example/callback?password=url-quote"secret-suffix&visible=yes',
    secrets: ['secret-suffix'],
  },
  {
    name: 'unquoted authorization assignments',
    value: 'authorization=Bearer bearer-assignment-secret\nproxy-authorization=Bearer proxy-bearer-assignment-secret\nx-mcp-authorization=Basic proxy-basic-assignment-secret',
    secrets: ['bearer-assignment-secret', 'proxy-bearer-assignment-secret', 'proxy-basic-assignment-secret'],
  },
  {
    name: 'a Basic credential assignment',
    value: 'authorization=Basic basic-assignment-secret',
    secrets: ['basic-assignment-secret'],
  },
  {
    name: 'a standalone Bearer credential',
    value: 'Observed Bearer serializer-secret',
    secrets: ['serializer-secret'],
  },
  {
    name: 'a nested assignment inside an error description',
    value: 'error_description=access_token=report-secret',
    secrets: ['report-secret'],
  },
  {
    name: 'a quoted nested assignment',
    value: 'message="client_secret=report-secret"',
    secrets: ['report-secret'],
  },
  {
    name: 'an encoded nested assignment in a URL',
    value: 'https://x.example/?error_description=access_token%3Dreport-secret',
    secrets: ['report-secret'],
  },
  {
    name: 'a repeatedly encoded query credential',
    value: 'https://x.example/?error_description=access_token%253Dencoded-report-secret',
    secrets: ['encoded-report-secret'],
  },
  {
    name: 'a query credential encoded past the decode bound',
    value: `https://x.example/?error_description=${uriEncodeTimes('access_token=bounded-report-secret', 10)}`,
    secrets: ['bounded-report-secret'],
  },
  {
    name: 'a singly encoded sensitive query name',
    value: 'https://client.example/?access%5Ftoken=single-name-secret',
    secrets: ['single-name-secret'],
  },
  {
    name: 'a repeatedly encoded sensitive query name',
    value: 'https://client.example/?access%255Ftoken=repeated-name-secret',
    secrets: ['repeated-name-secret'],
  },
  {
    name: 'a sensitive query name encoded past the decode bound',
    value: `https://client.example/?${uriEncodeTimes('access%5Ftoken', 6)}=bounded-name-secret`,
    secrets: ['bounded-name-secret'],
  },
  {
    name: 'OAuth correlation values across nested URLs',
    value: 'https://target.example/mcp?state=target-state-secret https://auth.example/authorize?nonce=auth-nonce-secret https://outer.example/?next=https%3A%2F%2Finner.example%2F%3Fstate%3Dnested-state-secret',
    secrets: ['target-state-secret', 'auth-nonce-secret', 'nested-state-secret'],
  },
  {
    name: 'an authorization code in a callback URL',
    value: 'https://client.example/callback?authorization_code=url-secret',
    secrets: ['url-secret'],
  },
  {
    name: 'URL credentials in userinfo and fragment',
    value: 'https://user:userinfo-secret@client.example/callback#fragment-secret',
    secrets: ['userinfo-secret', 'fragment-secret'],
  },
  {
    name: 'a section name carrying an Authorization header',
    value: 'Authorization: Bearer section-name-secret',
    secrets: ['section-name-secret'],
  },
];

export const REPORT_REDACTION_VALUE_FIXTURES: readonly ReportRedactionValueFixture[] = [
  {
    name: 'structured OAuth credentials',
    value: { client_secret: 'client-value', cookie: 'session=value', safe: 'visible', code_challenge_methods_supported: ['S256'] },
    secrets: ['client-value', 'session=value'],
  },
  {
    name: 'compound credential-family keys',
    value: { apiKeyValue: 'compound-api-key-secret', api_key_value: 'structured-snake-api-key-secret', apiKeySupported: true, api_key_placement: 'header' },
    secrets: ['compound-api-key-secret', 'structured-snake-api-key-secret'],
  },
  {
    name: 'a structured JWT and header values',
    value: { jwt: 'structured-jwt-secret', authorizationHeader: 'ApiKey authorization-report-secret', cookieHeader: 'Cookie: a=cookie-one-secret' },
    secrets: ['structured-jwt-secret', 'authorization-report-secret', 'cookie-one-secret'],
  },
  {
    name: 'a JSON-shaped string under a neutral key',
    value: { jsonShaped: '{"access_token":"json-report-secret"}' },
    secrets: ['json-report-secret'],
  },
  {
    name: 'generic and OAuth codes next to a JSON-RPC error code',
    value: { code: 123456, authorizationCode: 'oauth-secret', error: { code: -32601, message: 'Method not found' } },
    secrets: ['123456', 'oauth-secret'],
  },
  {
    name: 'secrets in metadata keys',
    value: { 'https://example.test/?access_token=url-key-secret&visible=yes': 1, 'client_secret=assignment-key-secret': 2 },
    secrets: ['url-key-secret', 'assignment-key-secret'],
  },
  {
    name: 'nested credential objects under neutral keys',
    value: { request: { headers: { nested: { Authorization: 'Bearer deep-token' } } }, callback: 'https://client.example/callback?authorization_code=url-secret' },
    secrets: ['deep-token', 'url-secret'],
  },
  {
    name: 'a prefixed JSON fragment with an escaped bearer separator in nested metadata',
    value: { response: { body: String.raw`response: {"note":"Bearer example-access-token"}` } },
    secrets: ['example-access-token'],
  },
];
