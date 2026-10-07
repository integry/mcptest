// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '8314b7a654a53c4bc184db37fd38e14b8b50cede',
  commitDate: '2026-08-18T00:01:03+00:00',
  shortHash: '8314b7a'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
