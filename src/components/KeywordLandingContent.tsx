import React from 'react';
import { Link } from 'react-router-dom';
import {
  KEYWORD_LANDING_FAQ_TITLE,
  type KeywordLandingPage,
  type KeywordLandingSection,
} from '../content/keywordLandingPages';
import { LandingText } from './LandingText';

const Section: React.FC<{ section: KeywordLandingSection }> = ({ section }) => {
  const titleId = `${section.id}-title`;
  return (
    <section
      id={section.id}
      className={`keyword-landing-section${section.steps ? ' landing-steps' : ''}`}
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className="landing-section-title">{section.title}</h2>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="keyword-landing-paragraph"><LandingText value={paragraph} /></p>
      ))}
      {section.steps && (
        <ol>
          {section.steps.map((step) => (
            <li key={step.title}>
              <h3 className="landing-step-title">{step.title}</h3>
              <p className="landing-step-description"><LandingText value={step.description} /></p>
            </li>
          ))}
        </ol>
      )}
      {section.items && (
        <ul className="keyword-landing-items">
          {section.items.map((item) => (
            <li key={item.title}>
              <h3 className="keyword-landing-item-title">{item.title}</h3>
              <p className="keyword-landing-item-description"><LandingText value={item.description} /></p>
            </li>
          ))}
        </ul>
      )}
      {section.table && (
        <div className="keyword-landing-table-wrapper">
          <table className="keyword-landing-table">
            <caption>{section.table.caption}</caption>
            <thead>
              <tr>
                {section.table.columns.map((column, index) => (
                  index === 0
                    ? <td key={index}>{column}</td>
                    : <th key={index} scope="col">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) => (
                    index === 0
                      ? <th key={index} scope="row">{cell}</th>
                      : <td key={index}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.after?.map((paragraph) => (
        <p key={paragraph} className="keyword-landing-paragraph"><LandingText value={paragraph} /></p>
      ))}
    </section>
  );
};

/**
 * Everything on a keyword landing page below the connect form: its sections,
 * FAQ and related links (src/content/keywordLandingPages.ts).
 */
export const KeywordLandingContent: React.FC<{ page: KeywordLandingPage }> = ({ page }) => {
  const faqTitleId = `${page.key}-faq-title`;
  const relatedTitleId = `${page.key}-related-title`;
  return (
    <>
      {page.sections.map((section) => (
        <Section key={section.id} section={section} />
      ))}

      <section id="faq" className="landing-faq" aria-labelledby={faqTitleId}>
        <h2 id={faqTitleId} className="landing-section-title">{KEYWORD_LANDING_FAQ_TITLE}</h2>
        {page.faq.map((item) => (
          <div key={item.question} className="landing-faq-item">
            <h3 className="landing-faq-question">{item.question}</h3>
            <p className="landing-faq-answer"><LandingText value={item.answer} /></p>
          </div>
        ))}
      </section>

      <nav className="landing-paths keyword-landing-related" aria-labelledby={relatedTitleId}>
        <h2 id={relatedTitleId} className="landing-section-title">{page.relatedTitle}</h2>
        <ul>
          {page.related.map((link) => (
            <li key={link.href}>
              <Link to={link.href} className="landing-path">
                <span className="landing-path-title">{link.label}</span>
                <span className="landing-path-description">{link.description}</span>
                <span className="landing-path-arrow" aria-hidden="true">&rarr;</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
};

export default KeywordLandingContent;
