// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '95196c6131e133524a54733f87e8c851d3309ecf',
  commitDate: '2026-10-25T12:40:14+02:00',
  shortHash: '95196c6'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
