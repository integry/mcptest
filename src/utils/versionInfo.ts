// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '643187628a6eb8b4a17909a1ff28dd40ce2f05a2',
  commitDate: '2025-07-31T13:43:18+03:00',
  shortHash: '6431876'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
