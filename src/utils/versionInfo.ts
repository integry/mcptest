// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '004be9fc3c16388bc807b4616d93e2e2e3cdfe8a',
  commitDate: '2025-09-05T13:48:43+03:00',
  shortHash: '004be9f'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
