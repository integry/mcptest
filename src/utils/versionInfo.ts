// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'f994c9ad09e33e319e9a624878e90ecb2954e014',
  commitDate: '2025-08-08T01:21:45+03:00',
  shortHash: 'f994c9a'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
