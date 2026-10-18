import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const { FFMPEG_COMPONENT, buildFfmpegArgs, ffmpegPath, installFfmpeg, isFfmpegInstalled, parseDuration, parseProgressFraction } =
  await import('../electron/materials/ffmpeg.ts');

test('从 FFmpeg 输出读时长和进度，一段输出里有多个 time= 取最后一个', () => {
  assert.equal(parseDuration('  Duration: 00:01:02.50, start: 0.000000'), 62.5);
  assert.equal(parseDuration('no duration here'), 0);
  assert.equal(parseProgressFraction('frame=1 time=00:00:10.00 bitrate=1\rframe=2 time=00:00:31.25 bitrate=1', 62.5), 0.5);
  assert.equal(parseProgressFraction('time=00:02:00.00', 62.5), 1);
  assert.equal(parseProgressFraction('time=00:00:10.00', 0), 0);
});

test('缩到目标分辨率时只缩小不放大，原分辨率不加缩放', () => {
  const scaled = buildFfmpegArgs('in.mov', 'out.mp4', { resolution: '720p', crf: 28, codec: 'h264' }, ['-c:v', 'libx264']);
  assert.deepEqual(scaled.slice(scaled.indexOf('-vf'), scaled.indexOf('-vf') + 2), ['-vf', "scale=-2:'min(720,ih)'"]);
  assert.equal(scaled.at(-1), 'out.mp4');
  assert.ok(scaled.includes('+faststart'));
  const original = buildFfmpegArgs('in.mov', 'out.mp4', { resolution: 'original', crf: 28, codec: 'h264' }, ['-c:v', 'libx264']);
  assert.equal(original.includes('-vf'), false);
});

test('下载到的 FFmpeg 校验不通过时拒绝启用，也不留下半截文件', async () => {
  const server = http.createServer((_request, response) => response.end('not ffmpeg'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-ffmpeg-test-'));
  try {
    await assert.rejects(installFfmpeg(userData, `http://127.0.0.1:${server.address().port}`, () => {}), /校验不通过/);
    assert.equal(isFfmpegInstalled(userData), false);
    assert.deepEqual(fs.readdirSync(path.dirname(ffmpegPath(userData))), []);
    await assert.rejects(installFfmpeg(userData, '', () => {}), /没有配置更新源/);
    assert.match(FFMPEG_COMPONENT.sha256, /^[0-9a-f]{64}$/);
  } finally {
    server.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
