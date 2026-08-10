import {
  getEvaluationPercentage,
  isAuthenticationRequired,
  type EvaluationReport,
} from './evaluation';

export interface TestedServerHistoryEntry {
  url: string;
  score: number | null;
  timestamp: number;
  outcome?: 'scored' | 'authorization-required';
}

const getServerUrlIdentity = (value: string): string => {
  const trimmedValue = value.trim();
  try {
    const withProtocol = /^https?:\/\//i.test(trimmedValue)
      ? trimmedValue
      : `https://${trimmedValue}`;
    return new URL(withProtocol).toString();
  } catch {
    return trimmedValue;
  }
};

export const createTestedServerHistoryEntry = (
  report: EvaluationReport,
  timestamp = Date.now()
): TestedServerHistoryEntry => {
  if (isAuthenticationRequired(report)) {
    return {
      url: report.serverUrl,
      score: null,
      timestamp,
      outcome: 'authorization-required',
    };
  }

  return {
    url: report.serverUrl,
    score: Math.round(getEvaluationPercentage(report)),
    timestamp,
    outcome: 'scored',
  };
};

export const getTestedServerResultLabel = (
  server: TestedServerHistoryEntry
): string => {
  if (server.outcome === 'authorization-required') {
    return 'Authorization required - not scored';
  }
  return typeof server.score === 'number' ? `Score: ${server.score}%` : 'Not scored';
};

export const upsertTestedServerHistoryEntry = (
  servers: readonly TestedServerHistoryEntry[],
  newServer: TestedServerHistoryEntry
): TestedServerHistoryEntry[] => {
  const newServerIdentity = getServerUrlIdentity(newServer.url);
  return [
    newServer,
    ...servers.filter((server) => getServerUrlIdentity(server.url) !== newServerIdentity),
  ];
};
