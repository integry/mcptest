// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '7d628d1b33af55bb01fd0492e6d58b9f5780caf9',
  commitDate: '2025-09-04T11:04:04+02:00',
  shortHash: '7d628d1'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
