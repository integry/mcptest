// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '5aaa44d7bec13175856a9e2a7ffeb0c722f43dd1',
  commitDate: '2026-08-11T12:24:32+01:00',
  shortHash: '5aaa44d'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
