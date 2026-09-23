const test = require('node:test');
const assert = require('node:assert/strict');

const {
  slugify,
  joinGroupPath,
  splitGroupPath,
  isValidSlug,
} = require('../dist/main/shared/credentials/group-path.js');

test('slugifies a display name into a kebab-case slug', () => {
  assert.equal(slugify('Acme App'), 'acme-app', 'a space becomes one dash');
  assert.equal(
    slugify('  ioAire   Cloud  '),
    'ioaire-cloud',
    'surrounding and repeated whitespace collapse away',
  );
  assert.equal(
    slugify('Terraform / Production'),
    'terraform-production',
    'a run of separators becomes one dash',
  );
  assert.equal(
    slugify('!!!'),
    '',
    'a name with no slug characters yields an empty slug for the caller to reject',
  );
});

test('joins a slug chain into a group path and drops empty segments', () => {
  assert.equal(
    joinGroupPath(['acme-app', 'kamal']),
    'acme-app/kamal',
    'slugs join with a single slash',
  );
  assert.equal(
    joinGroupPath(['a', '', 'b']),
    'a/b',
    'a stray empty segment cannot produce a doubled slash',
  );
  assert.equal(joinGroupPath([]), '', 'an empty chain is the empty path');
});

test('splits a group path into slugs and round-trips a valid chain', () => {
  assert.deepEqual(
    splitGroupPath('acme-app/kamal'),
    ['acme-app', 'kamal'],
    'each slash-separated segment is one slug',
  );
  assert.deepEqual(
    splitGroupPath('/a//b/'),
    ['a', 'b'],
    'leading, trailing, and doubled slashes yield no empty slugs',
  );
  assert.deepEqual(splitGroupPath(''), [], 'the empty path holds no slugs');

  const chain = ['acme-app', 'kamal', 'a1'];
  assert.deepEqual(
    splitGroupPath(joinGroupPath(chain)),
    chain,
    'a valid slug chain survives a join then a split',
  );
});

test('accepts only kebab-case slugs with no separators', () => {
  assert.equal(isValidSlug('acme-app'), true, 'a two-word kebab slug is valid');
  assert.equal(isValidSlug('kamal'), true, 'a single word is valid');
  assert.equal(isValidSlug('a1'), true, 'a digit is a slug character');
  assert.equal(isValidSlug('acme/app'), false, 'a slash would break group-path splitting');
  assert.equal(isValidSlug('acme app'), false, 'whitespace is not a slug character');
  assert.equal(isValidSlug(''), false, 'the empty string is not a slug');
  assert.equal(isValidSlug('Acme-App'), false, 'uppercase is not a slug character');
  assert.equal(isValidSlug('-kamal'), false, 'a leading dash is not allowed');
  assert.equal(isValidSlug('kamal-'), false, 'a trailing dash is not allowed');
  assert.equal(isValidSlug('acme--app'), false, 'a doubled dash is not allowed');
});
