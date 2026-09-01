const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatConversationTitle,
} = require('../dist/main/shared/conversation-title.js');

test('keeps conversation titles at or below the display limit intact', () => {
  const title = '123456789012345678901234567890';
  assert.equal(formatConversationTitle(title), title);
});

test('shortens long conversation titles to 30 characters with an ellipsis', () => {
  assert.equal(
    formatConversationTitle('1234567890123456789012345678901'),
    '123456789012345678901234567...',
  );
});
