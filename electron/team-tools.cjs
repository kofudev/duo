const schema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const string = { type: 'string' };
function teamTools({ ssh = false, write = false, commands = false } = {}) {
  const tools = [
    {
      name: 'duo_team_status',
      description:
        'Read live shared mission objective, tasks, current partner activity, recent messages and observed file changes. Call before work and before final response.',
      inputSchema: schema({}),
    },
    {
      name: 'duo_message_partner',
      description:
        'Send a concise visible handoff, decision or finding to partner. This adds to their shared inbox without starting another model call.',
      inputSchema: schema({ message: string }, ['message']),
    },
    {
      name: 'duo_consult_partner',
      description:
        'Ask partner to inspect actual project files and answer a concrete technical question now. Answer appears in shared conversation and is returned to you. Partner reads only. Bounded calls; never use for chatter or for user decisions.',
      inputSchema: schema({ question: string }, ['question']),
    },
    {
      name: 'duo_request_user',
      description:
        'Pause mission for missing user information, scope or permission. Provide one actionable question. No review/correction loop while waiting. Do not ask user to type CONTINUE instead of supplying missing information.',
      inputSchema: schema(
        { question: string, options: { type: 'array', items: string, maxItems: 4 } },
        ['question']
      ),
    },
  ];
  if (ssh)
    tools.push(
      {
        name: 'duo_ssh_list',
        description:
          'List relative directory on selected SSH connection. Symlinks are not followed. No writes.',
        inputSchema: schema({ path: string }),
      },
      {
        name: 'duo_ssh_read',
        description:
          'Read UTF-8 remote file and SHA-256 on selected SSH connection. Relative path only. Secrets and symlinks excluded.',
        inputSchema: schema({ path: string }, ['path']),
      },
      ...(write
        ? [
            {
              name: 'duo_ssh_write',
              description:
                'Create or atomically replace UTF-8 file in authorized remote folder. Existing file: supply hash returned by read; new file: expectedHash null. Never invent hash. Parent directory must exist.',
              inputSchema: schema(
                { path: string, content: string, expectedHash: { type: ['string', 'null'] } },
                ['path', 'content', 'expectedHash']
              ),
            },
          ]
        : []),
      ...(commands
        ? [
            {
              name: 'duo_ssh_run',
              description:
                'Execute a shell command on explicitly authorized SSH server, starting in selected remote folder. This is not a filesystem sandbox. Preserve unrelated services. Use only requested work; report actual exit code. Timeout max 120 seconds. Do not expose credentials or run destructive commands outside authorized scope.',
              inputSchema: schema(
                { command: string, timeout: { type: 'integer', minimum: 1, maximum: 120 } },
                ['command']
              ),
            },
          ]
        : [])
    );
  return tools;
}
module.exports = { teamTools };
