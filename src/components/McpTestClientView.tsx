import React from 'react';
import { Link } from 'react-router-dom';
import CodeBlock from './learn/CodeBlock';
import { getPublicFixture } from '../data/publicFixtures';
import { CLIENT_CHECKLISTS } from '../content/mcpTestClientChecklist';
import {
  CLIENT_GUIDES,
  CONNECT_STEPS,
  EXAMPLE_NOTES,
  MCP_TEST_CLIENT_COPY as copy,
  MCP_TEST_CLIENT_FAQ,
  RELATED_GUIDES,
  SELF_CHECK_EXCHANGES,
  SELF_CHECK_FIELDS,
} from '../content/mcpTestClientCopy';
import { formatExchangeRequest, formatExchangeResponse, type HttpExchange } from '../content/mcpTestClientExchanges';
import { getServerUrl } from '../utils/urlUtils';
import './learn/ReadingLayout.css';
import './McpTestServersView.css';
import './McpTestClientView.css';

const Code: React.FC<{ language?: string; code: string }> = ({ language, code }) => (
  <CodeBlock><code className={language ? `language-${language}` : undefined}>{code}</code></CodeBlock>
);

const Exchange: React.FC<{ exchange: HttpExchange }> = ({ exchange }) => (
  <div className="mcp-test-client-exchange" data-exchange={exchange.id}>
    <p>{exchange.caption}</p>
    <p className="mcp-test-client-label">Request</p>
    <Code language="http" code={formatExchangeRequest(exchange)} />
    <p className="mcp-test-client-label">Expected response</p>
    <Code language="http" code={formatExchangeResponse(exchange)} />
    {exchange.abbreviated && <p className="mcp-test-server-note">{exchange.abbreviated}</p>}
  </div>
);

/**
 * /mcp-test-client: a protocol checklist for MCP clients, one section per
 * public fixture, with the exact request/response pairs to compare against a
 * client's log, a whoami/headers self-check and an FAQ.
 * scripts/generate-seo-pages.js prerenders this component
 * (src/prerender/contentPages.tsx) and adds the FAQPage JSON-LD.
 */
export default function McpTestClientView() {
  return (
    <div className="reading-shell reading-shell-single mcp-test-servers mcp-test-client">
      <article className="reading-article" aria-labelledby="mcp-test-client-title">
        <nav className="reading-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">mcptest.io</Link>
          <span aria-hidden="true">/</span>
          <span>Test your client</span>
        </nav>
        <header className="reading-header">
          <h1 id="mcp-test-client-title">{copy.heading}</h1>
          <p className="reading-summary">{copy.lede}</p>
        </header>
        <div className="reading-prose">
          <p>{copy.intro}</p>

          <h2 id="connect">Point your client at the fixtures</h2>
          <ol>{CONNECT_STEPS.map(step => <li key={step}>{step}</li>)}</ol>
          <p>
            Copy-paste configs for Claude Code, Cursor, VS Code, Windsurf, Codex and ChatGPT are
            on <Link to="/mcp-test-servers#connect-a-client">the test servers page</Link>.
          </p>

          <h2 id="checklist">The checklist</h2>
          <ul className="mcp-test-client-summary">
            {CLIENT_CHECKLISTS.map(checklist => (
              <li key={checklist.fixture}>
                <a href={`#checklist-${checklist.fixture}`}>{checklist.heading}</a>
                <ul>{checklist.items.map(item => <li key={item.id}><a href={`#check-${item.id}`}>{item.check}</a></li>)}</ul>
              </li>
            ))}
          </ul>
          <h3 id="reading-the-examples">Reading the examples</h3>
          <ul>{EXAMPLE_NOTES.map(note => <li key={note}>{note}</li>)}</ul>

          {CLIENT_CHECKLISTS.map(checklist => {
            const fixture = getPublicFixture(checklist.fixture);
            return (
              <section
                className="mcp-test-server"
                key={checklist.fixture}
                aria-labelledby={`checklist-${checklist.fixture}`}
                data-checklist={checklist.fixture}
              >
                <h2 id={`checklist-${checklist.fixture}`}>{checklist.heading}</h2>
                <p>{checklist.intro}</p>
                <Code code={fixture.url} />
                <p className="mcp-test-server-actions">
                  <Link className="btn btn-outline-primary btn-sm" to={getServerUrl(fixture.url)} data-test-fixture={fixture.id}>
                    Compare with mcptest.io’s client
                  </Link>
                  <Link className="mcp-test-server-note" to={`/mcp-test-servers#fixture-${fixture.id}`}>All {fixture.name} tools</Link>
                </p>
                {checklist.items.map(item => (
                  <section key={item.id} aria-labelledby={`check-${item.id}`} className="mcp-test-client-check" data-check={item.id}>
                    <h3 id={`check-${item.id}`}>{item.check}</h3>
                    <p>{item.detail}</p>
                    {item.exchanges.map(exchange => <Exchange key={exchange.id} exchange={exchange} />)}
                  </section>
                ))}
              </section>
            );
          })}

          <h2 id="self-check">Self-check: what did the server receive?</h2>
          <p>
            Ask your client, or the model behind it, to call the whoami and headers tools on the echo or auth-bearer
            fixture. The answer comes back in the tool result to your client only; nothing is stored. Compare it with
            what you configured:
          </p>
          <div className="reading-table">
            <table>
              <thead><tr><th scope="col">Field</th><th scope="col">What it tells you</th></tr></thead>
              <tbody>
                {SELF_CHECK_FIELDS.map(row => (
                  <tr key={row.field}><td><code>{row.field}</code></td><td>{row.meaning}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {SELF_CHECK_EXCHANGES.map(exchange => <Exchange key={exchange.id} exchange={exchange} />)}

          <h2 id="faq">FAQ</h2>
          {MCP_TEST_CLIENT_FAQ.map(entry => (
            <section key={entry.question} className="mcp-test-servers-faq mcp-test-client-faq">
              <h3>{entry.question}</h3>
              <p>{entry.answer}</p>
            </section>
          ))}

          <h2 id="client-guides">Client setup guides</h2>
          <ul>{CLIENT_GUIDES.map(guide => <li key={guide.path}><Link to={guide.path}>{guide.label}</Link></li>)}</ul>

          <h2 id="related">Related</h2>
          <ul>{RELATED_GUIDES.map(guide => <li key={guide.path}><Link to={guide.path}>{guide.label}</Link></li>)}</ul>
        </div>
      </article>
    </div>
  );
}
