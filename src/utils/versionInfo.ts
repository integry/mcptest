// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '017b9fb53bffee75439634bc2006ad33c9f3b36b',
  commitDate: '2025-08-25T19:03:04+02:00',
  shortHash: '017b9fb'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
