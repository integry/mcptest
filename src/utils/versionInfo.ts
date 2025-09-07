// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'fa202cc167173fe19958c2afaf5cfc5ea334fde6',
  commitDate: '2025-09-07T13:16:20+02:00',
  shortHash: 'fa202cc'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
