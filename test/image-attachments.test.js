const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseImageAttachmentDataUrl,
  validateImageAttachmentBytes,
  validateImageAttachmentMimeType,
} = require('../dist/main/shared/image-attachments.js');

test('accepts JPEG and PNG attachment MIME types', () => {
  assert.deepEqual(validateImageAttachmentMimeType('image/jpeg', 'photo.jpg'), {
    ok: true,
    mimeType: 'image/jpeg',
  });
  assert.deepEqual(validateImageAttachmentMimeType('image/png', 'screenshot.png'), {
    ok: true,
    mimeType: 'image/png',
  });
  assert.deepEqual(validateImageAttachmentMimeType('image/jpg', 'photo.jpg'), {
    ok: true,
    mimeType: 'image/jpeg',
  });
});

test('rejects unsupported image formats with a friendly message', () => {
  assert.deepEqual(validateImageAttachmentMimeType('image/avif', 'photo.avif'), {
    ok: false,
    message: '"photo.avif" cannot be attached. Tiginal supports JPEG and PNG images only. Please convert the image and try again.',
  });
});

test('rejects an AVIF data URL before it can be saved with a PNG extension', () => {
  assert.deepEqual(parseImageAttachmentDataUrl('data:image/avif;base64,AAAA'), {
    ok: false,
    message: 'This image cannot be attached. Tiginal supports JPEG and PNG images only. Please convert the image and try again.',
  });
});

test('rejects AVIF bytes that claim to be a PNG', () => {
  assert.deepEqual(
    validateImageAttachmentBytes('image/png', Buffer.from('000000206674797061766966', 'hex'), 'fake.png'),
    {
      ok: false,
      message: '"fake.png" cannot be attached. Tiginal supports JPEG and PNG images only. Please convert the image and try again.',
    },
  );
});

test('accepts matching JPEG and PNG signatures', () => {
  assert.deepEqual(
    validateImageAttachmentBytes('image/jpeg', Buffer.from('ffd8ffe0', 'hex'), 'photo.jpg'),
    { ok: true },
  );
  assert.deepEqual(
    validateImageAttachmentBytes('image/png', Buffer.from('89504e470d0a1a0a', 'hex'), 'screenshot.png'),
    { ok: true },
  );
});

test('parses supported image data URLs', () => {
  assert.deepEqual(parseImageAttachmentDataUrl('data:image/png;base64,iVBORw0KGgo='), {
    ok: true,
    attachment: {
      mimeType: 'image/png',
      encoding: 'base64',
      data: 'iVBORw0KGgo=',
    },
  });
});
