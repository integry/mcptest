// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '7aad22847fddda4fc1a7ae6aecc7caa9f9a720cc',
  commitDate: '2025-08-24T11:39:24+02:00',
  shortHash: '7aad228'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
