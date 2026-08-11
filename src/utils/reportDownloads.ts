import type { EvaluationReport } from './evaluation';
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
  generatedAt?: string | Date
): ReportDownload => {
  const artifact = createPublicReport(report, { generatedAt });
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

