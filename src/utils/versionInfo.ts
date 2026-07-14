// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'c5b2ffbf0a87c26cece50c1cfdf52ad9b36290d6',
  commitDate: '2026-07-14T12:21:08Z',
  shortHash: 'c5b2ffb'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
