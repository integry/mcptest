// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '3c63a773182cc50e430d8dd65f98d90ee419383b',
  commitDate: '2025-07-29T16:49:34+02:00',
  shortHash: '3c63a77'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
