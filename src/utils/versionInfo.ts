// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '6ccb76cea7d10a033e4b325ac0604a52892b664a',
  commitDate: '2025-08-25T14:11:12+02:00',
  shortHash: '6ccb76c'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
