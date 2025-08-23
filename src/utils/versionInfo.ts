// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '819200660270c3b852be9b2875d01503c7d315af',
  commitDate: '2025-08-18T13:40:33+03:00',
  shortHash: '8192006'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
