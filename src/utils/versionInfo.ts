// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '8653ce7fb903140ae04db55de2737e7aacb21369',
  commitDate: '2026-08-11T17:35:20+03:00',
  shortHash: '8653ce7'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
