// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'd67b4a93323abc214ba8693a1e905d897330992d',
  commitDate: '2025-08-06T12:19:48+02:00',
  shortHash: 'd67b4a9'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
