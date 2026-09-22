import test from 'node:test'
import assert from 'node:assert/strict'
import arxdl, { youtube, tiktok } from 'arxdl'
import * as youtubeV1 from 'arxdl/youtube/v1'
import * as youtubeV2 from 'arxdl/youtube/v2'
import * as tiktokV1 from 'arxdl/tiktok/v1'
import * as tiktokV2 from 'arxdl/tiktok/v2'
import * as tiktokV3 from 'arxdl/tiktok/v3'

test('all package exports load', () => {
  assert.equal(arxdl.youtube, youtube)
  assert.equal(arxdl.tiktok, tiktok)
  for (const api of [youtube, youtubeV1, youtubeV2, tiktok, tiktokV1, tiktokV2, tiktokV3]) {
    assert.equal(typeof api.download, 'function')
  }
})

test('YouTube utilities normalize values', () => {
  assert.equal(youtube.getId('https://youtu.be/jNQXAC9IVRw'), 'jNQXAC9IVRw')
  assert.equal(youtube.getId('invalid'), null)
  assert.equal(youtube.formatBytes(1048576), '1.0 MB')
  assert.equal(youtube.formatDuration(3661), '1:01:01')
})

test('downloaders reject invalid input without network access', async () => {
  await assert.rejects(youtube.download('invalid'), /Invalid YouTube URL/)
  await assert.rejects(tiktok.download('invalid'), /Invalid TikTok URL/)
})

test('downloaders preserve an existing abort reason', async () => {
  const controller = new AbortController()
  const reason = new Error('stopped')
  controller.abort(reason)
  await assert.rejects(youtube.download('jNQXAC9IVRw', { signal: controller.signal }), error => error === reason)
  await assert.rejects(tiktok.download('https://www.tiktok.com/@x/video/123', { signal: controller.signal }), error => error === reason)
})
