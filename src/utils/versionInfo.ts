// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '3dc3370017cd5103d3e04e4d8a14f3bacadcd660',
  commitDate: '2025-08-24T01:39:31+02:00',
  shortHash: '3dc3370'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
