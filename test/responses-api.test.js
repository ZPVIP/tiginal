const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildResponsesInput,
  buildResponsesRequest,
  parseResponsesOutput,
  responsesUrl,
} = require('../dist/main/main/services/ai/responses-api.js');

test('builds Responses API input with images and tool history', () => {
  assert.deepEqual(buildResponsesInput([
    { role: 'system', content: 'Be concise' },
    { role: 'user', content: [
      { type: 'text', text: 'Describe this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ] },
    { role: 'assistant', content: '', tool_calls: [{
      id: 'call_1',
      function: { name: 'lookup', arguments: '{"query":"x"}' },
    }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'result' },
  ]), [
    { role: 'system', content: 'Be concise' },
    { role: 'user', content: [
      { type: 'input_text', text: 'Describe this' },
      { type: 'input_image', image_url: 'data:image/png;base64,abc' },
    ] },
    { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"query":"x"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'result' },
  ]);
});

test('builds a Responses API request with flat function tools', () => {
  assert.deepEqual(buildResponsesRequest({
    model: 'gpt-5',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
    maxOutputTokens: 4000,
    reasoningEffort: 'high',
    tools: [{ name: 'lookup', description: 'Look up a value', input_schema: { type: 'object' } }],
  }), {
    model: 'gpt-5',
    input: [{ role: 'user', content: 'Hello' }],
    stream: true,
    max_output_tokens: 4000,
    reasoning: { effort: 'high' },
    tools: [{ type: 'function', name: 'lookup', description: 'Look up a value', parameters: { type: 'object' } }],
    tool_choice: 'auto',
  });
});

test('parses text from a Responses API output array', () => {
  assert.deepEqual(parseResponsesOutput({
    output: [{ type: 'message', content: [
      { type: 'output_text', text: 'Generated title' },
    ] }],
    usage: { input_tokens: 10, output_tokens: 2 },
  }), {
    content: 'Generated title',
    usage: { input_tokens: 10, output_tokens: 2 },
  });
});

test('does not duplicate the Responses path', () => {
  assert.equal(responsesUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/responses');
  assert.equal(responsesUrl('https://api.openai.com/v1/responses'), 'https://api.openai.com/v1/responses');
});
