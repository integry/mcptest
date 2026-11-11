// Version information - this should be updated during build process
export const VERSION_INFO = {
  commitHash: '655d583252328e3b09ce5d22ca7f40b7e67557ee',
  commitDate: '2026-11-10T16:04:29+01:00',
  shortHash: '655d583'
};

export const getGithubCommitUrl = (commitHash: string): string => {
  return `https://github.com/integry/mcptest/commit/${commitHash}`;
};
