// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '83416b42448b28690a757b65cc61f23c26f80350',
  commitDate: '2025-08-05T12:39:19+03:00',
  shortHash: '83416b4'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
