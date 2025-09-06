// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '747b38e93896fe3d71e22168db790d30a4a4dfab',
  commitDate: '2025-09-06T22:30:35+02:00',
  shortHash: '747b38e'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
