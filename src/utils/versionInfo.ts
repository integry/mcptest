// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '9b324898572afc1c4b1de416c0e2b09f873aa39d',
  commitDate: '2025-08-24T12:13:08+02:00',
  shortHash: '9b32489'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
