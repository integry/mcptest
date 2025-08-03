// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '589b99d86d13c1ef93562c698492ffe24fa853e1',
  commitDate: '2025-08-03T01:11:38+03:00',
  shortHash: '589b99d'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
