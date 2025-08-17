// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'f1b79f9f0e7a7760459934cb4ba24cf4447809e1',
  commitDate: '2025-08-18T00:11:48+03:00',
  shortHash: 'f1b79f9'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
