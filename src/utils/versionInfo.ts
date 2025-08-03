// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '016d71079546cc32ba79329f02130a6c540b05cf',
  commitDate: '2025-08-03T15:17:53+02:00',
  shortHash: '016d710'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
