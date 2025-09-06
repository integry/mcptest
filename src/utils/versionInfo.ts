// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'd76318fe27bb7c54448f04bdc804443f47a7f736',
  commitDate: '2025-09-06T20:17:01+02:00',
  shortHash: 'd76318f'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
