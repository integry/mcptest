import React from 'react';
import {
  directoryPreflightStatusLabel,
  type ConnectorDirectoryPreflightV1,
  type DirectoryPreflightItem,
  type DirectoryPreflightStatus,
} from '../utils/connectorDirectoryPreflight';
import './ConnectorDirectoryPreflight.css';

interface ConnectorDirectoryPreflightProps {
  preflight: ConnectorDirectoryPreflightV1;
}

const statusIcon: Record<DirectoryPreflightStatus, string> = {
  pass: 'bi-check-circle-fill',
  fail: 'bi-x-circle-fill',
  unknown: 'bi-question-circle-fill',
  'not-applicable': 'bi-dash-circle',
  manual: 'bi-clipboard-check',
};

const SourceLink: React.FC<{ url: string; title: string }> = ({ url, title }) => (
  <a className="directory-preflight__source" href={url} target="_blank" rel="noopener noreferrer" title={title}>
    Official source<span className="visually-hidden">: {title}</span>
  </a>
);

const ItemRow: React.FC<{ item: DirectoryPreflightItem }> = ({ item }) => (
  <li className={`directory-preflight__item directory-preflight__item--${item.status}`}>
    <span className="directory-preflight__status">
      <i className={`bi ${statusIcon[item.status]}`} aria-hidden="true"></i>
      {directoryPreflightStatusLabel(item.status)}
    </span>
    <div className="directory-preflight__body">
      <strong>{item.title}</strong>
      <p>{item.detail}</p>
      {item.evidence.length > 0 && (
        <ul className="directory-preflight__evidence">
          {item.evidence.map((value) => <li key={value}><code>{value}</code></li>)}
        </ul>
      )}
      <SourceLink url={item.source.url} title={item.source.title} />
    </div>
  </li>
);

/** Per-directory submission checklists; manual items link to the source instead of a verdict. */
const ConnectorDirectoryPreflight: React.FC<ConnectorDirectoryPreflightProps> = ({ preflight }) => (
  <section className="release-section" aria-labelledby="directory-preflight-title">
    <div className="release-section-heading">
      <div>
        <h3 id="directory-preflight-title">Connector directory preflight</h3>
        <p>
          Claude and ChatGPT directory requirements from official documentation, reviewed {preflight.requirementsReviewedOn}.
          {' '}Automatic items reuse this report&rsquo;s evidence; items marked manual review cannot be decided from the endpoint.
          {' '}<a href="/learn/mcp-connector-directory-requirements">Read the requirements guide</a>.
        </p>
      </div>
    </div>
    <div className="directory-preflight">
      {preflight.directories.map(({ directory, items, counts }) => {
        const automatic = items.filter((item) => item.check === 'automatic');
        const manual = items.filter((item) => item.check === 'manual');
        return (
          <article className="directory-preflight__directory" key={directory.id} aria-labelledby={`directory-preflight-${directory.id}`}>
            <div className="directory-preflight__heading">
              <h4 id={`directory-preflight-${directory.id}`}>{directory.name}</h4>
              <span className="text-muted small">
                {counts.pass} pass · {counts.fail} fail · {counts.unknown} unknown · {counts.manual} manual review
              </span>
            </div>
            <h5 className="directory-preflight__group">Checked from this report</h5>
            <ul className="directory-preflight__items">
              {automatic.map((item) => <ItemRow item={item} key={item.id} />)}
            </ul>
            <details className="release-details">
              <summary>Manual checklist ({manual.length})</summary>
              <ul className="directory-preflight__items">
                {manual.map((item) => <ItemRow item={item} key={item.id} />)}
              </ul>
            </details>
          </article>
        );
      })}
      {preflight.advisories.map((advisory) => (
        <aside className="directory-preflight__advisory" key={advisory.id} aria-label="Directory advisory">
          <div className="directory-preflight__heading">
            <h4><i className="bi bi-info-circle me-2" aria-hidden="true"></i>{advisory.title}</h4>
            <span className="finding-severity">Advisory</span>
          </div>
          <p>{advisory.explanation}</p>
          <ul className="directory-preflight__evidence">
            {advisory.matches.map((match) => (
              <li key={`${match.tool}:${match.argument}`}>
                <code>{match.tool}</code> argument <code>{match.argument}</code> selects {match.values.join(', ')}
              </li>
            ))}
          </ul>
          <p className="mb-0">
            {advisory.sources.map((source, index) => (
              <React.Fragment key={source.url}>
                {index > 0 && ' · '}
                <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
              </React.Fragment>
            ))}
          </p>
        </aside>
      ))}
    </div>
  </section>
);

export default ConnectorDirectoryPreflight;
