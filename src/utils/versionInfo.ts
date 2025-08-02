// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '390924d93c49126cd6e6ef606cd0130e95c58a25',
  commitDate: '2025-08-02T12:50:52+02:00',
  shortHash: '390924d'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
