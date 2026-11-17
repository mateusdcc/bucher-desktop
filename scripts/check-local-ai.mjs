import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';

const model = 'fixture:latest';
const samples = [
  ['question', '6 is even because $6 = 2 \\cdot 3$.'],
  ['instructions', 'Write the integers as $2a$ and $2b$. Their sum is $2(a+b)$, which is even.'],
  ['attempt', 'Correctness: 2/10. Use the definition of even to justify that this sum is even.'],
  ['markdown', { replacement: 'The sum of 2 and 4 is 6.\n' }],
  ['title', {
    introduction: 'A quick guide.',
    chapters: [{ title: 'Definition', markdown: 'Even integers are multiples of two.' }],
  }],
];
let generated = 0;
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  try {
    if (request.method === 'GET' && request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [
        { name: model, capabilities: ['completion'] },
        { name: 'excluded:cloud', remote_model: 'remote' },
      ] }));
      return;
    }
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/generate');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    const [field, sample] = samples[generated];
    assert.equal(body.model, model);
    assert.equal(body.stream, false);
    assert.ok(Object.hasOwn(JSON.parse(body.prompt), field));
    if (typeof sample === 'object') {
      assert.ok(body.format.required.every(key => Object.hasOwn(sample, key)));
    }
    generated += 1;
    response.end(JSON.stringify({
      done: true,
      done_reason: 'stop',
      response: typeof sample === 'string' ? sample : JSON.stringify(sample),
    }));
  } catch (error) {
    console.error(error);
    response.statusCode = 500;
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(0, '127.0.0.1');
try {
  await once(server, 'listening');
  const cargo = spawn('cargo', [
    'test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked',
    'ai_command_smoke', '--', '--ignored',
  ], {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit',
    env: { ...process.env, BUCHER_AI_FIXTURE_PORT: String(server.address().port) },
  });
  const [code] = await once(cargo, 'exit');
  assert.equal(code, 0, 'AI command smoke test failed.');
  assert.equal(generated, samples.length, 'Every generation command must use a sample response.');
} finally {
  server.close();
}
