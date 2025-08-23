// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'c8a6e6713c57e956f7480041212debf90e21afb8',
  commitDate: '2025-08-24T01:26:16+02:00',
  shortHash: 'c8a6e67'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
