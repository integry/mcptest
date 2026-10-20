import React, { useMemo } from 'react';
import type { EvaluationReport } from '../utils/evaluation';
import type { OAuthTraceV1 } from '../utils/oauthTrace';
import { createCompatibilityMatrix, createReleaseDecision } from '../utils/releaseReadiness';
import {
  createPublishedReportBadgeSnippets,
  createReportBadgeSnippets,
  getBadgeTitle,
  getBadgeVariantForResult,
  getReportUrl,
  getStaticBadgeUrl,
  type BadgeVariant,
} from '../utils/badges';
import BadgeEmbed from './BadgeEmbed';

/** Selects the badge for a report from the same release decision the report displays. */
export const getReportBadgeVariant = (report: EvaluationReport, oauthTrace?: OAuthTraceV1): BadgeVariant => {
  const matrix = createCompatibilityMatrix(report, oauthTrace);
  return getBadgeVariantForResult(
    createReleaseDecision(report, matrix, report.toolSurfaceAnalysis, oauthTrace).status
  );
};

interface ReportBadgeEmbedProps {
  report: EvaluationReport;
  oauthTrace?: OAuthTraceV1;
  /** When the endpoint has a published report, snippets use the live badge that follows it. */
  publishedEndpoint?: string;
}

const ReportBadgeEmbed: React.FC<ReportBadgeEmbedProps> = ({ report, oauthTrace, publishedEndpoint }) => {
  const variant = useMemo(() => getReportBadgeVariant(report, oauthTrace), [report, oauthTrace]);
  const snippets = useMemo(() => (
    publishedEndpoint
      ? createPublishedReportBadgeSnippets(publishedEndpoint)
      : createReportBadgeSnippets(report.serverUrl, variant)
  ), [report.serverUrl, variant, publishedEndpoint]);

  return (
    <BadgeEmbed
      titleId="report-badge-embed-title"
      description={publishedEndpoint
        ? <>Add this badge to your README. It follows the latest published report for <code className="technical-string technical-string-url">{publishedEndpoint}</code> (refreshed hourly) and links to its public report page.</>
        : <>Add this badge to your README. It records this report&apos;s result at the time you copy it (catalog badges update with each validation run) and links to the public report for <code className="technical-string technical-string-url">{report.serverUrl}</code>. Publish the report below to get a live badge instead.</>}
      previewSrc={getStaticBadgeUrl(variant, '')}
      previewAlt={getBadgeTitle(variant)}
      linkUrl={getReportUrl(report.serverUrl)}
      snippets={snippets}
    />
  );
};

export default ReportBadgeEmbed;
