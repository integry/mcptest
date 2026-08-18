// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '8650f6081b8dd3c289aff47014bb12d137582b82',
  commitDate: '2026-08-18T14:16:05+03:00',
  shortHash: '8650f60'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
