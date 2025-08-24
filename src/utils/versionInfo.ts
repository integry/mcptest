// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: 'b64a906eb53479fa5d6f30ec1e35cb51c7300376',
  commitDate: '2025-08-24T01:47:16+02:00',
  shortHash: 'b64a906'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
