// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '9f9d70d2fa60d82618b25d84bcb52580a1d96f74',
  commitDate: '2025-09-05T14:04:49+02:00',
  shortHash: '9f9d70d'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
