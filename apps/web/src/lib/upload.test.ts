// Upload intake: data-URL parsing, magic-byte type checks, deterministic
// ids. No network, no keys. Run: node --test src/lib/upload.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageDataUrl, sniffImageType, uploadIdFromBytes } from './upload.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

describe('parseImageDataUrl', () => {
  it('decodes a png data url to bytes', () => {
    const b64 = Buffer.from(PNG).toString('base64');
    const out = parseImageDataUrl(`data:image/png;base64,${b64}`);
    assert.ok(out);
    assert.equal(out.mime, 'image/png');
    assert.deepEqual(out.bytes, PNG);
  });

  it('rejects non-image mimes, bad base64 and empty payloads', () => {
    assert.equal(parseImageDataUrl('data:text/plain;base64,aGk='), null);
    assert.equal(parseImageDataUrl('not-a-data-url'), null);
    assert.equal(parseImageDataUrl('data:image/png;base64,'), null);
    assert.equal(parseImageDataUrl('data:image/png;base64,!!!'), null);
  });
});

describe('sniffImageType', () => {
  it('accepts png, jpeg and webp by magic bytes', () => {
    assert.equal(sniffImageType(PNG), 'png');
    assert.equal(sniffImageType(JPEG), 'jpeg');
    assert.equal(sniffImageType(WEBP), 'webp');
  });

  it('rejects gif and anything else, whatever the client claimed', () => {
    assert.equal(sniffImageType(GIF), null);
    assert.equal(sniffImageType(new Uint8Array([1, 2, 3])), null);
    assert.equal(sniffImageType(new Uint8Array([])), null);
  });
});

describe('uploadIdFromBytes', () => {
  it('is deterministic and byte-bound', () => {
    const a = uploadIdFromBytes(PNG);
    assert.match(a, /^upl-[0-9a-f]{16}$/);
    assert.equal(a, uploadIdFromBytes(PNG));
    assert.notEqual(a, uploadIdFromBytes(JPEG));
  });
});
