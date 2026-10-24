// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'f7ca7ec0e3979ed2c63d44604fff542cd5ac514f',
  commitDate: '2026-10-20T20:08:00+03:00',
  shortHash: 'f7ca7ec'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
