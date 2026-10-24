// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '2c36081f2cabdd9ed5a892a3cd6a7f71fa5d67e2',
  commitDate: '2026-10-24T22:29:18+03:00',
  shortHash: '2c36081'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
