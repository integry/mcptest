// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'fd167ced7750a549dbe9dcf26e026c6d1b1a44fd',
  commitDate: '2025-09-04T11:16:46+02:00',
  shortHash: 'fd167ce'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
