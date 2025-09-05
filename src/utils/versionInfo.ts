// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'd32900393b0ce4bea26325244c8d24a0953324ce',
  commitDate: '2025-09-04T13:22:36+02:00',
  shortHash: 'd329003'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
