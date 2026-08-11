import type { CompatibilityMatrixV1 } from '../compatibility';
import type { ToolSurfaceAnalysisV1 } from '../types/toolSurfaceAnalysis';
import type { EvaluationReport } from './evaluation';
import type { OAuthTraceV1 } from './oauthTrace';
import type { ReleaseDecision } from './releaseReadiness';
import {
  createPublicReport,
  serializePublicReportJson,
  serializePublicReportMarkdown,
} from './reportArtifact';

export type ReportDownloadFormat = 'json' | 'markdown';

export interface ReportDownload {
  content: string;
  filename: string;
  mimeType: string;
}

export interface ReleaseReadinessDownloadData {
  releaseDecision: ReleaseDecision;
  compatibilityMatrix: CompatibilityMatrixV1;
  toolSurfaceAnalysis?: ToolSurfaceAnalysisV1;
  oauthTrace?: OAuthTraceV1;
}

const safeHost = (serverUrl: string): string => {
  try {
    return new URL(serverUrl).hostname.replace(/[^a-z0-9.-]+/gi, '-');
  } catch {
    return 'mcp-server';
  }
};

/** Creates downloadable bytes through the shared, validated report serializers. */
export const createReportDownload = (
  report: EvaluationReport,
  format: ReportDownloadFormat,
  generatedAt?: string | Date,
  releaseReadiness?: ReleaseReadinessDownloadData
): ReportDownload => {
  const artifact = createPublicReport(report, {
    generatedAt,
    ...releaseReadiness,
  });
  const base = `mcptest-${safeHost(report.serverUrl)}-report`;
  return format === 'json'
    ? {
        content: serializePublicReportJson(artifact),
        filename: `${base}.json`,
        mimeType: 'application/json',
      }
    : {
        content: serializePublicReportMarkdown(artifact),
        filename: `${base}.md`,
        mimeType: 'text/markdown',
      };
};

export const saveReportDownload = (download: ReportDownload): void => {
  const objectUrl = URL.createObjectURL(new Blob([download.content], { type: download.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = download.filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
};
