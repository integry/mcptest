// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '97a021911ede37adc4760ac08c5d779a4969f3ca',
  commitDate: '2025-08-02T17:21:46+03:00',
  shortHash: '97a0219'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
