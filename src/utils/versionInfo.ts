// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'b766ca9eec68492db20b28c901503e7739554f3b',
  commitDate: '2025-09-07T16:28:39Z',
  shortHash: 'b766ca9'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
