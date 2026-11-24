// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'a91ad859c7dddcbbd3996e44f12ebf6a3f85ff30',
  commitDate: '2026-11-24T00:53:57+00:00',
  shortHash: 'a91ad85'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
