// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'b2d1e4b57fe9bec3eb1a6fdb5fabf98459fdd937',
  commitDate: '2026-08-11T23:01:34+03:00',
  shortHash: 'b2d1e4b'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
