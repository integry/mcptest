// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'b7f83f34918be890c10e398db8900530619b0cb0',
  commitDate: '2025-09-06T23:58:08+02:00',
  shortHash: 'b7f83f3'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
