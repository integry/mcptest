// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'eb0653b00be63089a70bb86adf49fbbd63eb86e0',
  commitDate: '2025-08-16T20:44:28+03:00',
  shortHash: 'eb0653b'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
