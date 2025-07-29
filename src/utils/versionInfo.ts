// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '52c6c52bebad0094d3284798207a8d3e6d981e47',
  commitDate: '2025-07-29T22:43:02+03:00',
  shortHash: '52c6c52'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
