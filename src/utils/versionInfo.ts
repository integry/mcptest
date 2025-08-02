// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '45fd1ab22e19e1da5cafc9975972ecbd53720712',
  commitDate: '2025-08-02T19:26:16+03:00',
  shortHash: '45fd1ab'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
