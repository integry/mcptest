import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BASIC_SCOPE,
  ESTIMATE_NOTE,
  INDEPENDENCE_STATEMENT,
  ORDERS_CLOSED,
  PRICE_FALLBACK,
  QUOTED_TIER,
  QUOTE_ACTION_LABEL,
  QUOTE_CONTACT_PATH,
  QUOTE_FAILED,
  QUOTE_LOADING_LABEL,
  SERVICE_OPTIONS,
  SERVICE_PAGE_COPY as copy,
  WHAT_YOU_GET,
  howItWorks,
  maintenancePrice,
  taxNote,
} from '../content/servicePageCopy';
import { SERVICE_PAGE } from '../servicePage/buildFlag';
import type { ServicePageConfig } from '../servicePage/config.mts';
import { fetchServiceOffer, formatPrice, type ServiceOffer } from '../servicePage/offer';
import { createQuoteAssistant, type QuoteAssistant } from '../servicePage/quoteAssistant';
import './learn/ReadingLayout.css';
import './ServicePageView.css';

type OfferState = { status: 'loading' } | { status: 'ready'; offer: ServiceOffer } | { status: 'unavailable' };

export interface ServicePageViewProps {
  config?: ServicePageConfig;
  loadOffer?: (serviceApi: string | null, signal: AbortSignal) => Promise<ServiceOffer | null>;
  createAssistant?: typeof createQuoteAssistant;
}

const defaultLoadOffer = (serviceApi: string | null, signal: AbortSignal) => fetchServiceOffer(serviceApi, { signal });

/**
 * "Get a quote": opens the quote assistant when this build has one,
 * otherwise links to the contact page.
 */
const QuoteAction: React.FC<{ config: ServicePageConfig; createAssistant: typeof createQuoteAssistant }> = ({ config, createAssistant }) => {
  const assistantRef = useRef<QuoteAssistant | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  useEffect(() => () => {
    assistantRef.current?.destroy();
    assistantRef.current = null;
  }, []);

  if (!config.quoteAssistant) {
    return <Link className="btn btn-primary" to={QUOTE_CONTACT_PATH}>{QUOTE_ACTION_LABEL}</Link>;
  }
  const quoteAssistant = config.quoteAssistant;
  const open = () => {
    if (state === 'loading') return;
    assistantRef.current ??= createAssistant(quoteAssistant, config.serviceApi);
    setState('loading');
    void assistantRef.current.open().then(opened => setState(opened ? 'idle' : 'failed'));
  };
  return (
    <div className="service-quote-action">
      <button
        type="button"
        className="btn btn-primary"
        onClick={open}
        aria-busy={state === 'loading' || undefined}
        data-state={state === 'idle' ? undefined : state}
      >
        {state === 'loading' ? `${QUOTE_LOADING_LABEL}…` : QUOTE_ACTION_LABEL}
      </button>
      {state === 'failed' && (
        <p className="service-quote-error" role="alert">
          {QUOTE_FAILED} <Link to={QUOTE_CONTACT_PATH}>Contact</Link>
        </p>
      )}
    </div>
  );
};

const OfferSummary: React.FC<{ offer: ServiceOffer }> = ({ offer }) => (
  <>
    {offer.offers.length > 0 && (
      <ul className="service-offer-list" aria-label="Offers">
        {offer.offers.map(item => (
          <li key={item.id} data-offer={item.id}>
            <span className="service-offer-name">{item.name}</span>
            <span className="service-offer-price">from {formatPrice(item.fromPrice, offer.currency)}</span>
            {item.deliveryDays && (
              <span className="service-offer-delivery">delivery in about {item.deliveryDays} {item.deliveryDays === 1 ? 'day' : 'days'}</span>
            )}
          </li>
        ))}
      </ul>
    )}
    {offer.maintenanceMonthlyPrice !== null && (
      <p data-offer="maintenance">
        Hosting and maintenance: {maintenancePrice(formatPrice(offer.maintenanceMonthlyPrice, offer.currency), offer.paymentMethod)}.
      </p>
    )}
  </>
);

/**
 * /mcp-server-development: fixed-scope MCP server development, in builds with
 * VITE_SERVICE_PAGE_ENABLED=true. Prices come from the service's public offer
 * at runtime; the prerendered HTML (scripts/generate-seo-pages.js) has the
 * neutral fallback copy.
 */
export default function ServicePageView({
  config = SERVICE_PAGE,
  loadOffer = defaultLoadOffer,
  createAssistant = createQuoteAssistant,
}: ServicePageViewProps) {
  const [offerState, setOfferState] = useState<OfferState>(() => (config.serviceApi ? { status: 'loading' } : { status: 'unavailable' }));

  useEffect(() => {
    if (!config.serviceApi) {
      setOfferState({ status: 'unavailable' });
      return;
    }
    const controller = new AbortController();
    setOfferState({ status: 'loading' });
    loadOffer(config.serviceApi, controller.signal).then(
      offer => { if (!controller.signal.aborted) setOfferState(offer ? { status: 'ready', offer } : { status: 'unavailable' }); },
      () => { if (!controller.signal.aborted) setOfferState({ status: 'unavailable' }); },
    );
    return () => controller.abort();
  }, [config.serviceApi, loadOffer]);

  const offer = offerState.status === 'ready' ? offerState.offer : null;
  const ordersClosed = offer?.ordersOpen === false;

  return (
    <div className="reading-shell reading-shell-single service-page">
      <article className="reading-article" aria-labelledby="service-page-title">
        <nav className="reading-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">mcptest.io</Link>
          <span aria-hidden="true">/</span>
          <span>{copy.breadcrumb}</span>
        </nav>
        <header className="reading-header">
          <h1 id="service-page-title">{copy.heading}</h1>
          <p className="reading-summary">{copy.lede}</p>
        </header>
        <div className="reading-prose">
          <h2 id="what-you-get">What you get</h2>
          <ul>{WHAT_YOU_GET.map(item => <li key={item}>{item}</li>)}</ul>

          <h2 id="scope">The basic scope</h2>
          <p>The basic offer is a fixed scope:</p>
          <ul>{BASIC_SCOPE.map(item => <li key={item}>{item}</li>)}</ul>
          <p>These move a job to a quoted tier:</p>
          <ul>{QUOTED_TIER.map(item => <li key={item.label}><strong>{item.label}</strong>: {item.detail}</li>)}</ul>

          <h2 id="options">Options</h2>
          <dl className="service-options">
            {SERVICE_OPTIONS.map(option => (
              <div key={option.id} data-option={option.id}>
                <dt>{option.title}</dt>
                <dd>{option.detail}</dd>
              </div>
            ))}
          </dl>

          <section className="service-offer" aria-labelledby="prices" aria-busy={offerState.status === 'loading' || undefined} data-offer-state={offerState.status}>
            <h2 id="prices">Prices</h2>
            {offer && offer.offers.length > 0 ? <OfferSummary offer={offer} /> : (
              <>
                <p>{PRICE_FALLBACK}</p>
                {offer && <OfferSummary offer={offer} />}
              </>
            )}
            <p className="service-offer-note" data-note="tax">{taxNote(offer?.currency ?? null, offer?.paymentMethod)}</p>
            <p className="service-offer-note" data-note="estimate">{ESTIMATE_NOTE}</p>
            {ordersClosed
              ? <p className="service-orders-closed" role="status">{ORDERS_CLOSED}</p>
              : <QuoteAction config={config} createAssistant={createAssistant} />}
          </section>

          <h2 id="how-it-works">How it works</h2>
          <ol>{howItWorks(offer?.paymentMethod).map(step => <li key={step}>{step}</li>)}</ol>

          <h2 id="independence">Independence</h2>
          <p>{INDEPENDENCE_STATEMENT}</p>
        </div>
      </article>
    </div>
  );
}
