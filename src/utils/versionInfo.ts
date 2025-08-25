// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'd2ee5bbacdc96a16cc9dfaeff45dea8d91959996',
  commitDate: '2025-08-25T19:13:05+02:00',
  shortHash: 'd2ee5bb'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
