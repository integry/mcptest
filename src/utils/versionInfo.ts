// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '293ae8db1a4655e8ecf9d016d26411850ed6e344',
  commitDate: '2025-09-06T15:57:17+02:00',
  shortHash: '293ae8d'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
