// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'ca220bcae8c616a98db0e41664f75fbd5b0316aa',
  commitDate: '2025-08-28T14:15:38+02:00',
  shortHash: 'ca220bc'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
