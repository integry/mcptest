// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '4b9df77ae99a9504baa5f63b1f85db9384c51c61',
  commitDate: '2025-08-19T01:14:52+02:00',
  shortHash: '4b9df77'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
