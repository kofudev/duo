const path = require('node:path');
const { log, report } = require('./ai-runtime.cjs');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.293 (LOCAL FIXTURE Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth') {
  console.log(
    JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'fixture' })
  );
  process.exit(0);
}
if (args.includes('--input-format')) {
  require('node:readline')
    .createInterface({ input: process.stdin })
    .on('line', (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'control_request' && event.request?.subtype === 'initialize') {
        log({ event: 'metadata', agent: 'claude', promptSent: false });
        console.log(
          JSON.stringify({
            type: 'control_response',
            response: {
              subtype: 'success',
              request_id: event.request_id,
              response: {
                commands: [],
                agents: [],
                output_style: 'default',
                available_output_styles: [],
                account: {},
                models: [
                  {
                    value: 'opus',
                    displayName: 'Opus · simulation locale',
                    description: 'Métadonnées fixture.',
                    resolvedModel: 'claude-opus-5-5',
                    supportsEffort: true,
                    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
                  },
                ],
              },
            },
          })
        );
      }
    });
  return;
}
let prompt = '';
process.stdin.on('data', (chunk) => {
  prompt += chunk;
});
process.stdin.on('end', async () => {
  const write = args[args.indexOf('--permission-mode') + 1] === 'acceptEdits';
  log({ event: 'permissions', agent: 'claude', write, tools: args[args.indexOf('--tools') + 1] });
  if (prompt.includes('MOCK_CANCEL')) {
    log({ event: 'waiting', agent: 'claude' });
    setInterval(() => {}, 1000);
    return;
  }
  try {
    const text = await report('claude', prompt, path.resolve(process.cwd()), write, (name, file) =>
      console.log(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name, input: { file_path: file } }] },
        })
      )
    );
    console.log(
      JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: text.slice(0, 45) } },
      })
    );
    console.log(
      JSON.stringify({
        type: 'stream_event',
        event: { delta: { type: 'text_delta', text: text.slice(45) } },
      })
    );
    console.log(
      JSON.stringify({
        type: 'result',
        is_error: false,
        result: text,
        usage: { input_tokens: 130, output_tokens: 50, cache_read_input_tokens: 12 },
      })
    );
  } catch (error) {
    console.log(JSON.stringify({ type: 'result', is_error: true, result: error.message }));
    process.exitCode = 1;
  }
});
