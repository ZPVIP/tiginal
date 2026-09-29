const test = require('node:test');
const assert = require('node:assert/strict');
const {
  smartJoinText,
  separateGluedWords,
  suppressRepetitiveLoops,
  cleanSegmentText,
} = require('../dist/main/shared/audio/textUtils');

test('separateGluedWords: separates glued words while preserving whitelisted terms', () => {
  assert.equal(separateGluedWords('StartBusy'), 'Start Busy');
  assert.equal(separateGluedWords('morningHere'), 'morning Here');
  assert.equal(separateGluedWords('chargeAt'), 'charge At');
  assert.equal(separateGluedWords('sitTraffic'), 'sit Traffic');
  assert.equal(separateGluedWords('serverYeah'), 'server Yeah');
  assert.equal(separateGluedWords('supervisorYeah'), 'supervisor Yeah');
  assert.equal(separateGluedWords('hereI\'ve'), 'here I\'ve');
  assert.equal(separateGluedWords('ByeYeah'), 'Bye Yeah');
  // Whitelist
  assert.equal(separateGluedWords('ChatGPT is smart'), 'ChatGPT is smart');
  assert.equal(separateGluedWords('an iOS app for iPad'), 'an iOS app for iPad');
  assert.equal(separateGluedWords('SharePoint and NetSuite'), 'SharePoint and NetSuite');
});

test('smartJoinText: inserts space between English alphanumeric boundaries', () => {
  assert.equal(smartJoinText('Start', 'Busy'), 'Start Busy');
  assert.equal(smartJoinText('restroom', 'right'), 'restroom right');
  assert.equal(smartJoinText('in', 'better'), 'in better');
  assert.equal(smartJoinText('Helco one is', 'the mobile app'), 'Helco one is the mobile app');
  assert.equal(smartJoinText('within Poco', 'One'), 'within Poco One');
  assert.equal(smartJoinText('could be', 'a'), 'could be a');
  assert.equal(smartJoinText('figure', 'out'), 'figure out');
  assert.equal(smartJoinText('how', 'we'), 'how we');
});

test('smartJoinText: preserves English contractions without space', () => {
  assert.equal(smartJoinText('I', "'m"), "I'm");
  assert.equal(smartJoinText('it', "'s"), "it's");
  assert.equal(smartJoinText('we', "'re"), "we're");
  assert.equal(smartJoinText('they', "'ve"), "they've");
});

test('smartJoinText: punctuation followed by word gets space', () => {
  assert.equal(smartJoinText('meeting,', 'so'), 'meeting, so');
  assert.equal(smartJoinText('done.', 'Perfect'), 'done. Perfect');
  assert.equal(smartJoinText('right?', 'Yeah'), 'right? Yeah');
});

test('smartJoinText: respects existing whitespace', () => {
  assert.equal(smartJoinText('Hello ', 'world'), 'Hello world');
  assert.equal(smartJoinText('Hello', ' world'), 'Hello world');
});

test('smartJoinText: handles CJK characters without extra spaces', () => {
  assert.equal(smartJoinText('你好', '世界'), '你好世界');
  assert.equal(smartJoinText('天气', '很好。'), '天气很好。');
});

test('suppressRepetitiveLoops: compresses long single-word floods', () => {
  const flood = 'talking about, John, no, okay, ' + Array(50).fill('no').join(', ') + ', Louisville.';
  const cleaned = suppressRepetitiveLoops(flood, 3);
  assert.ok(!cleaned.includes('no, no, no, no'));
  assert.ok(cleaned.includes('Louisville'));
  assert.ok(cleaned.includes(', Louisville'));
});

test('suppressRepetitiveLoops: normalizes punctuation followed by English letters', () => {
  assert.equal(suppressRepetitiveLoops('Okay,Louisville'), 'Okay, Louisville');
  assert.equal(suppressRepetitiveLoops('fine.Yeah'), 'fine. Yeah');
});

test('cleanSegmentText: strips leading orphan punctuation and trims', () => {
  assert.equal(cleanSegmentText('. Okay, all right.'), 'Okay, all right.');
  assert.equal(cleanSegmentText(', we are here'), 'we are here');
  assert.equal(cleanSegmentText('   ..  Hello!  '), 'Hello!');
});
