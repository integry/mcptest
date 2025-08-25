// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '6c6ff6399522ec1a669b68f46bee44fda23724b9',
  commitDate: '2025-08-25T12:24:23+02:00',
  shortHash: '6c6ff63'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
