const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldUseSkillsForProfile,
} = require('../dist/main/shared/profile-skills.js');

test('enables the chat skill toggle for a profile with selected skills', () => {
  assert.equal(shouldUseSkillsForProfile(JSON.stringify({
    global_enabled: true,
    enabled_directory_ids: ['skills-dir'],
    enabled_skill_ids: [10],
  })), true);
});

test('keeps the chat skill toggle off when a profile selects no skills', () => {
  assert.equal(shouldUseSkillsForProfile(JSON.stringify({
    global_enabled: true,
    enabled_directory_ids: [],
    enabled_skill_ids: [],
  })), false);
});

test('keeps the chat skill toggle off when skills are globally disabled', () => {
  assert.equal(shouldUseSkillsForProfile(JSON.stringify({
    global_enabled: false,
    enabled_directory_ids: ['skills-dir'],
    enabled_skill_ids: [10],
  })), false);
});

test('keeps the chat skill toggle off for malformed profile data', () => {
  assert.equal(shouldUseSkillsForProfile('{not-json'), false);
  assert.equal(shouldUseSkillsForProfile(null), false);
});
