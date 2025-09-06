// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '7b02ac224c4e28c80300d84170606436df8b64e7',
  commitDate: '2025-09-06T10:57:13+02:00',
  shortHash: '7b02ac2'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
