import crypto from 'crypto'
import { getId } from './search.js'

async function download(input, { type = 'audio', quality, signal } = {}) {
  const id = getId(input)
  if (!id) throw new Error('Invalid YouTube URL or video ID')

  const format = ['audio', 'mp3'].includes(type) ? 'mp3' : ['video', 'mp4'].includes(type) ? 'mp4' : null
  if (!format) throw new Error('Type must be "audio", "video", "mp3" or "mp4"')

  const disponibles = format === 'mp4' ? ['360', '480', '720', '1080'] : ['128', '320']
  let calidades

  if (quality != null) {
    const q = String(quality).match(/\d+/)?.[0]
    if (!disponibles.includes(q)) throw new Error(`Unsupported ${format} quality. Available: ${disponibles.join(', ')}`)
    calidades = [q]
  } else calidades = shuffle(disponibles)

  const errores = []
  for (const calidad of calidades) {
    try {
      const archivo = await savetube(id, format, calidad, signal)
      const size = await getFileSize(archivo.url, signal).catch(() => null)
      return {
        id,
        type: format === 'mp3' ? 'audio' : 'video',
        format,
        quality: format === 'mp4' ? `${calidad}p` : `${calidad} kbps`,
        size,
        ...archivo
      }
    } catch (error) {
      if (signal?.aborted) throw error
      errores.push(`${calidad}: ${error?.message ?? error}`)
    }
  }

  throw new Error(errores.at(-1) ?? 'Unable to download video')
}

async function savetube(id, format, quality, signal) {
  const cdn = await getCdn(signal)

  const info = await postJson(`https://${cdn}/v2/info`, {
    url: `https://www.youtube.com/watch?v=${id}`
  }, withTimeout(signal, 60000))

  if (!info?.status || !info?.data) throw new Error(info?.message ?? 'SaveTube could not process the video')

  const meta = decrypt(info.data)
  const response = await postJson(`https://${cdn}/download`, {
    downloadType: format === 'mp4' ? 'video' : 'audio',
    quality: String(quality),
    key: meta.key
  }, withTimeout(signal, 300000))

  const url = response?.data?.downloadUrl
  if (typeof url !== 'string' || url.includes('googlevideo.com')) throw new Error(`CDN URL unavailable for quality ${quality}`)

  return {
    url,
    title: meta.title || 'YouTube',
    filename: `${cleanFilename(meta.title)}.${format}`
  }
}

async function getCdn(signal) {
  const response = await fetch('https://media.savetube.vip/api/random-cdn', {
    headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36'
    },
    signal: withTimeout(signal, 30000)
  })

  if (!response.ok) throw new Error(`SaveTube responded ${response.status}`)

  const data = await response.json().catch(() => null)
  if (!data?.cdn) throw new Error('Unable to obtain SaveTube CDN')
  return data.cdn
}

function decrypt(data) {
  const raw = Buffer.from(data, 'base64')
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex'),
    raw.subarray(0, 16)
  )
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString('utf8'))
}

async function postJson(url, body, signal) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36'
    },
    body: JSON.stringify(body),
    signal
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message ?? `Request failed with status ${response.status}`)
  return data
}

async function getFileSize(url, signal) {
  const head = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    signal: withTimeout(signal, 30000)
  }).catch(() => null)

  const length = Number(head?.headers?.get('content-length'))
  if (length > 0) return length

  const response = await fetch(url, {
    headers: {
      range: 'bytes=0-0',
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36'
    },
    redirect: 'follow',
    signal: withTimeout(signal, 30000)
  }).catch(() => null)

  await response?.body?.cancel().catch(() => null)

  const total = Number(response?.headers?.get('content-range')?.match(/\/(\d+)$/)?.[1])
  if (total > 0) return total

  const size = Number(response?.headers?.get('content-length'))
  return size > 0 ? size : null
}

function cleanFilename(value) {
  return String(value ?? 'YouTube').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'YouTube'
}

function shuffle(values) {
  const list = [...values]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

function withTimeout(signal, timeout) {
  const timer = AbortSignal.timeout(timeout)
  return signal ? AbortSignal.any([signal, timer]) : timer
}

export { download, savetube }
export default { download }