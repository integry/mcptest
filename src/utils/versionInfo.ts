// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '57934875d36d43ec7fec7973109b05627b614cae',
  commitDate: '2025-08-26T19:17:40+02:00',
  shortHash: '5793487'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
