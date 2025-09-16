// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'cbe70ae8de6fe58e19f0a010e42a75296c0df505',
  commitDate: '2025-09-16T11:58:24+03:00',
  shortHash: 'cbe70ae'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
