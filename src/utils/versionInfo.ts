// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '635fc06bf09c76b5e85b8a989c2e47f57ad6f6d6',
  commitDate: '2026-10-25T18:47:26+02:00',
  shortHash: '635fc06'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
