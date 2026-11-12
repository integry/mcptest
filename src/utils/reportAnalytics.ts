import { getScoreBand, type AnalyticsEventParams, type ReportSurface } from './analytics';
import { getEvaluationPercentage, resolveEvaluationOutcome, type EvaluationReport } from './evaluation';
import type { OAuthTraceV1 } from './oauthTrace';
import { createCompatibilityMatrix, createReleaseDecision } from './releaseReadiness';

/** `report_generated` params from the same release decision and grade the report displays. */
export const getReportGeneratedParams = (
  report: EvaluationReport,
  oauthTrace: OAuthTraceV1 | undefined,
  surface: ReportSurface
): AnalyticsEventParams<'report_generated'> => {
  const scoreBand = resolveEvaluationOutcome(report) === 'scored'
    ? getScoreBand(getEvaluationPercentage(report))
    : 'unscored';
  try {
    const matrix = createCompatibilityMatrix(report, oauthTrace);
    const decision = createReleaseDecision(report, matrix, report.toolSurfaceAnalysis, oauthTrace);
    return { result_status: decision.status, score_band: scoreBand, surface };
  } catch {
    return { result_status: 'unknown', score_band: scoreBand, surface };
  }
};
