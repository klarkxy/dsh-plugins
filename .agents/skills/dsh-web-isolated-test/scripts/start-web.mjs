console.error([
  'start-web.mjs is retired.',
  'It inherited the parent environment, left DSH_AGENTS_HOME on the shared agents home,',
  'and captured a launch URL that still carried the token.',
  'Use node .agents/skills/dsh-web-acceptance/scripts/dsh-qa-harness.js',
].join('\n'))
process.exit(1)
