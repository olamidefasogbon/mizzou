// Regression: /api/chat once required 21 characters while /api/upload made
// 20, so every attached image was silently dropped and Mizzou answered as
// if no picture was sent. Run: node --test src/lib/upload-id.test.ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isUploadId, uploadIdFromBytes } from './upload-id.ts';

describe('upload id', () => {
  it('accepts every id the upload route can produce', () => {
    for (const seed of ['a', 'flyer', 'x'.repeat(5000)]) {
      assert.ok(isUploadId(uploadIdFromBytes(new TextEncoder().encode(seed))));
    }
  });

  it('rejects anything else', () => {
    assert.ok(!isUploadId('upl-abc'));
    assert.ok(!isUploadId('upl-' + 'g'.repeat(16)));
    assert.ok(!isUploadId('upl-' + 'a'.repeat(17)));
    assert.ok(!isUploadId(42));
  });
});
