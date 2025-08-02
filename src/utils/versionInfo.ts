// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '97b145fa5f3da3090354fe62fe2f6e7f1bf8fd6a',
  commitDate: '2025-08-02T17:46:59+02:00',
  shortHash: '97b145f'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
