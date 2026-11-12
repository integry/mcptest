// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '20f38f7b045c82002866821218581373bcf7cffe',
  commitDate: '2026-11-12T01:06:56+00:00',
  shortHash: '20f38f7'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
