// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '783cdd3547a20710c8f32ab9eb83365f167bcac2',
  commitDate: '2025-09-06T17:15:17+02:00',
  shortHash: '783cdd3'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
