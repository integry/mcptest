// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'db852e9b2bdc74b564d839111acfe2357e4f4f2c',
  commitDate: '2025-08-02T12:31:49+02:00',
  shortHash: 'db852e9'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
