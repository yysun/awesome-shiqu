import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sha256Hex, sha256HexFallback} from '../site/assets/sha256.mjs';

const reference = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesFor = length => Uint8Array.from({length}, (_, index) => (index * 31 + (index >>> 8)) & 255);

test('portable SHA-256 matches the empty and abc reference vectors', async () => {
  for (const [text, expected] of [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ]) {
    const bytes = new TextEncoder().encode(text);
    assert.equal(sha256HexFallback(bytes), expected);
    assert.equal(await sha256Hex(bytes), expected);
  }
});

test('portable SHA-256 matches Node at message-padding and block boundaries', () => {
  for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129]) {
    const bytes = bytesFor(length);
    assert.equal(sha256HexFallback(bytes), reference(bytes), `length ${length}`);
  }
});

test('portable SHA-256 handles a 1 MiB input without altering its bytes', async () => {
  const bytes = bytesFor(1024 * 1024 + 17), expected = reference(bytes);
  assert.equal(sha256HexFallback(bytes), expected);
  assert.equal(await sha256Hex(bytes), expected);
  assert.equal(reference(bytes), expected);
});

test('SHA-256 respects Uint8Array offsets and accepts an ArrayBuffer', async () => {
  const containing = bytesFor(151), bytes = containing.subarray(7, 139), expected = reference(bytes);
  assert.equal(sha256HexFallback(bytes), expected);
  assert.equal(await sha256Hex(bytes), expected);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(sha256HexFallback(buffer), expected);
  assert.equal(await sha256Hex(buffer), expected);
  assert.throws(() => sha256HexFallback('abc'), /Uint8Array/);
  await assert.rejects(sha256Hex('abc'), /Uint8Array/);
});

test('async SHA-256 prefers Web Crypto and retains verification when it is unavailable', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const bytes = bytesFor(65), expected = reference(bytes);
  let nativeCalls = 0;
  try {
    Object.defineProperty(globalThis, 'crypto', {configurable: true, value: {
      subtle: {async digest(algorithm, input) {
        nativeCalls++; assert.equal(algorithm, 'SHA-256');
        const digest = createHash('sha256').update(input).digest();
        return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
      }},
    }});
    assert.equal(await sha256Hex(bytes), expected); assert.equal(nativeCalls, 1);
    Object.defineProperty(globalThis, 'crypto', {configurable: true, value: undefined});
    assert.equal(await sha256Hex(bytes), expected);
    Object.defineProperty(globalThis, 'crypto', {configurable: true, value: {
      subtle: {async digest() { throw new Error('Web Crypto unavailable in this context'); }},
    }});
    assert.equal(await sha256Hex(bytes), expected);
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
});
