import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { startServer } from '../src/server.js';

/**
 * Reads an SSE response body and reassembles base64 `data:` payloads.
 */
async function downloadFileViaSse(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = '';
  const parts = [];
  let doneEvent = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    textBuffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = textBuffer.indexOf('\n\n')) !== -1) {
      const rawMessage = textBuffer.slice(0, boundary);
      textBuffer = textBuffer.slice(boundary + 2);

      let eventName = 'message';
      const dataLines = [];
      for (const line of rawMessage.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
      }

      const data = dataLines.join('\n');
      if (eventName === 'done') {
        doneEvent = JSON.parse(data);
      } else if (data.length > 0) {
        parts.push(Buffer.from(data, 'base64'));
      }
    }
  }

  const file = Buffer.concat(parts);
  return { file, doneEvent };
}

describe('SSE file download', () => {
  /** @type {import('node:http').Server} */
  let server;
  let baseUrl;

  before(async () => {
    const started = await startServer(0);
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}`;
  });

  after(() => {
    server.close();
  });

  it('downloads a random 1 MiB file over SSE', async () => {
    const { file, doneEvent } = await downloadFileViaSse(`${baseUrl}/download`);

    assert.equal(file.length, 1024 * 1024);
    assert.ok(doneEvent);
    assert.equal(doneEvent.bytes, 1024 * 1024);

    const clientHash = crypto.createHash('sha256').update(file).digest('hex');
    assert.equal(clientHash, doneEvent.sha256);
  });
});
