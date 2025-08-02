// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '97b54258c2ed18005b475a25104fda0b06d8e731',
  commitDate: '2025-08-02T18:32:41+03:00',
  shortHash: '97b5425'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
