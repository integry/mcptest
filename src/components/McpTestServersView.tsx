import React from 'react';
import { Link } from 'react-router-dom';
import CodeBlock from './learn/CodeBlock';
import { PUBLIC_FIXTURES, PUBLIC_FIXTURE_BEARER_TOKEN } from '../data/publicFixtures';
import {
  CLIENT_SETUPS,
  CURL_EXAMPLES,
  MCP_TEST_SERVERS_COPY as copy,
  MCP_TEST_SERVERS_FAQ,
  type SetupSnippet,
} from '../content/mcpTestServersCopy';
import { getServerUrl } from '../utils/urlUtils';
import './learn/ReadingLayout.css';
import './McpTestServersView.css';

const Code: React.FC<{ language?: string; code: string }> = ({ language, code }) => (
  <CodeBlock><code className={language ? `language-${language}` : undefined}>{code}</code></CodeBlock>
);

const Snippet: React.FC<{ snippet: SetupSnippet }> = ({ snippet }) => (
  <>
    {snippet.steps && <ol>{snippet.steps.map(step => <li key={step}>{step}</li>)}</ol>}
    {snippet.code && snippet.caption && <p>{snippet.caption}</p>}
    {snippet.code && <Code language={snippet.language} code={snippet.code} />}
    {!snippet.code && snippet.caption && <p>{snippet.caption}</p>}
  </>
);

const RELATED_GUIDES = [
  { path: '/docs/testing-guide', label: 'How to test a remote MCP server, step by step' },
  { path: '/learn/test-remote-mcp-server-in-ci', label: 'Test a remote MCP server in CI' },
  { path: '/learn/mcp-json-rpc-error-codes', label: 'MCP JSON-RPC error codes' },
  { path: '/learn/mcp-protocol-versions-explained', label: 'MCP protocol versions explained' },
  { path: '/learn/best-remote-mcp-testing-tools', label: 'Remote MCP testing tools compared' },
];

/**
 * /mcp-test-servers: the public fixture servers, copy-paste client setups,
 * curl examples and an FAQ. scripts/generate-seo-pages.js prerenders this
 * component (src/prerender/contentPages.tsx) and adds the FAQPage JSON-LD.
 */
export default function McpTestServersView() {
  return (
    <div className="reading-shell reading-shell-single mcp-test-servers">
      <article className="reading-article" aria-labelledby="mcp-test-servers-title">
        <nav className="reading-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">mcptest.io</Link>
          <span aria-hidden="true">/</span>
          <span>Test servers</span>
        </nav>
        <header className="reading-header">
          <h1 id="mcp-test-servers-title">{copy.heading}</h1>
          <p className="reading-summary">{copy.lede}</p>
        </header>
        <div className="reading-prose">
          <p>{copy.intro}</p>
          <div className="reading-table">
            <table>
              <thead><tr><th scope="col">Server</th><th scope="col">Endpoint</th><th scope="col">Use it to test</th></tr></thead>
              <tbody>
                {PUBLIC_FIXTURES.map(fixture => (
                  <tr key={fixture.id}>
                    <td><a href={`#fixture-${fixture.id}`}>{fixture.name}</a></td>
                    <td><code>{fixture.url}</code></td>
                    <td>{fixture.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 id="servers">The test servers</h2>
          {PUBLIC_FIXTURES.map(fixture => (
            <section className="mcp-test-server" key={fixture.id} aria-labelledby={`fixture-${fixture.id}`} data-fixture={fixture.id}>
              <h3 id={`fixture-${fixture.id}`}>{fixture.name}</h3>
              <p>{fixture.purpose}</p>
              <Code code={fixture.url} />
              <p className="mcp-test-server-actions">
                <Link className="btn btn-primary btn-sm" to={getServerUrl(fixture.url)} data-test-fixture={fixture.id}>
                  Test in mcptest.io
                </Link>
                {fixture.auth && (
                  <span className="mcp-test-server-note">
                    {' '}The tester reports the 401 first; enter <code>{PUBLIC_FIXTURE_BEARER_TOKEN}</code> as the bearer token and connect again.
                  </span>
                )}
              </p>
              <h4>Tools</h4>
              <ul>
                {fixture.tools.map(tool => <li key={tool.name}><code>{tool.name}</code>: {tool.summary}</li>)}
              </ul>
              {(fixture.resources.length > 0 || fixture.prompts.length > 0) && (
                <p>
                  {fixture.resources.length > 0 && <>Resource: {fixture.resources.map(uri => <code key={uri}>{uri}</code>)}. </>}
                  {fixture.prompts.length > 0 && <>Prompt: {fixture.prompts.map(name => <code key={name}>{name}</code>)}.</>}
                </p>
              )}
              <h4>Expected behavior</h4>
              <ul>
                {fixture.behavior.map(line => <li key={line}>{line}</li>)}
              </ul>
            </section>
          ))}

          <h2 id="connect-a-client">Connect a client</h2>
          <p>
            These snippets add the echo server; swap in any URL above. The formats are the ones each client documents,
            as covered in the client setup guides.
          </p>
          {CLIENT_SETUPS.map(setup => (
            <section key={setup.id} aria-labelledby={`client-${setup.id}`}>
              <h3 id={`client-${setup.id}`}>{setup.client}</h3>
              <p>{setup.location}</p>
              {setup.snippets.map((snippet, index) => <Snippet key={index} snippet={snippet} />)}
              <p><Link to={setup.guidePath}>{setup.client} setup guide</Link></p>
            </section>
          ))}

          <h2 id="curl">Test with curl</h2>
          <p>
            Raw JSON-RPC over HTTP, for checking a proxy, a firewall or your own client code. The stateful flow
            is <code>initialize</code>, then <code>tools/list</code> and <code>tools/call</code> with the session ID.
          </p>
          {CURL_EXAMPLES.map(example => (
            <section key={example.id} aria-labelledby={example.id}>
              <h3 id={example.id}>{example.title}</h3>
              <p>{example.description}</p>
              <Code language="bash" code={example.code} />
              {example.expected && <p><strong>Expected: </strong>{example.expected}</p>}
            </section>
          ))}

          <h2 id="faq">FAQ</h2>
          {MCP_TEST_SERVERS_FAQ.map(entry => (
            <section key={entry.question} className="mcp-test-servers-faq">
              <h3>{entry.question}</h3>
              <p>{entry.answer}</p>
            </section>
          ))}

          <h2 id="related">Related guides</h2>
          <ul>
            {RELATED_GUIDES.map(guide => <li key={guide.path}><Link to={guide.path}>{guide.label}</Link></li>)}
          </ul>
        </div>
      </article>
    </div>
  );
}
