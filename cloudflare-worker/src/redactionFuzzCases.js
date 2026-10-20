// Test support: every credential fixture of the app's redaction tests, embedded
// in each encoding position the Worker must see through. Used by the Worker
// suites to assert the storage invariant: whatever the publish route stores
// passes the detection guard and carries none of the fixture secrets.
import {
  REPORT_REDACTION_STRING_FIXTURES,
  REPORT_REDACTION_VALUE_FIXTURES,
} from '../../src/utils/reportRedactionFixtures.ts';

const enc = encodeURIComponent;
// `encodeURIComponent` keeps `'`; encode it too so the userinfo embeddings carry no quotes.
const encUserinfo = (text) => enc(text).replace(/'/g, '%27');
const unicodeEscape = (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
const escapeNonAlphanumerics = (text) => text.replace(/[^A-Za-z0-9]/g, unicodeEscape);

/** Each embedding takes the fixture text and returns the string the artifact carries. */
export const CREDENTIAL_EMBEDDINGS = [
  ['a URL query name', (text) => `https://fuzz.example/?${enc(text)}=1`],
  ['a URL query name with a marker value', (text) => `https://fuzz.example/?${enc(text)}=%5BREDACTED%5D`],
  ['a doubly encoded URL query name', (text) => `https://fuzz.example/?${enc(enc(text))}=1`],
  ['a JSON-encoded URL query name', (text) => `https://fuzz.example/?${enc(JSON.stringify(text))}=1`],
  ['a URL query value', (text) => `https://fuzz.example/?q=${enc(text)}`],
  ['a doubly encoded URL query value', (text) => `https://fuzz.example/?q=${enc(enc(text))}`],
  ['an escaped URL query value', (text) => `https://fuzz.example/?q=${enc(escapeNonAlphanumerics(text))}`],
  ['a URL path segment', (text) => `https://fuzz.example/${enc(text)}/mcp`],
  ['a URL fragment', (text) => `https://fuzz.example/mcp#${enc(text)}`],
  ['URL userinfo', (text) => `https://${enc(text)}@fuzz.example/mcp`],
  ['an https URL userinfo password', (text) => `https://alice:${enc(text)}@fuzz.example/mcp`],
  ['an ftp URL userinfo password', (text) => `ftp://alice:${enc(text)}@fuzz.example/report`],
  ['a wss URL userinfo password', (text) => `wss://alice:${enc(text)}@fuzz.example/mcp`],
  ['a custom-scheme URL userinfo password', (text) => `x-mcp+v1://alice:${enc(text)}@fuzz.example/session`],
  ['a file URL userinfo password', (text) => `file://alice:${encUserinfo(text)}@fuzz.example/report`],
  ['a bare user:password@host outside a URL', (text) => `sftp alice:${encUserinfo(text)}@fuzz.example:22`],
  ['a scheme-prefixed userinfo password without //', (text) => `https:alice:${encUserinfo(text)}@fuzz.example/report`],
  ['a JSON-encoded string', (text) => JSON.stringify(text)],
  ['a twice JSON-encoded string', (text) => JSON.stringify(JSON.stringify(text))],
  ['a JSON fragment after a prefix', (text) => `response: ${JSON.stringify({ note: text })} end`],
  ['JSON string escapes without quotes', (text) => JSON.stringify(text).slice(1, -1)],
  ['unicode escape sequences', escapeNonAlphanumerics],
  ['a URL query name inside a JSON fragment', (text) => `seen {"url":"https://fuzz.example/?${enc(text)}=1"}`],
];

const FIXTURE_TEXTS = [
  ...REPORT_REDACTION_STRING_FIXTURES.map(({ name, value, secrets }) => ({ name, text: value, secrets })),
  ...REPORT_REDACTION_VALUE_FIXTURES.map(({ name, value, secrets }) => ({
    name: `${name} (serialized)`, text: JSON.stringify(value), secrets,
  })),
];

/** [name, text, secrets] for every fixture in every embedding. */
export const CREDENTIAL_FUZZ_CASES = CREDENTIAL_EMBEDDINGS.flatMap(([position, embed]) => (
  FIXTURE_TEXTS.map(({ name, text, secrets }) => [`${name} inside ${position}`, embed(text), secrets])
));

/** The fixture secrets present in `text`, in any of the encodings the embeddings use. */
export const findEmbeddedSecret = (text, secrets) => secrets.find((secret) => (
  text.includes(secret)
  || text.includes(enc(secret))
  || text.includes(enc(enc(secret)))
  || text.includes(JSON.stringify(secret).slice(1, -1))
  || text.includes(escapeNonAlphanumerics(secret))
));
