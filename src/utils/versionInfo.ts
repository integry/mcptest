// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '17b2b2c1e63a42cfc67b622fa76700d41d0d6b22',
  commitDate: '2026-10-20T02:47:44+00:00',
  shortHash: '17b2b2c'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
