async function download(input, { type = 'audio', quality, signal } = {}) {
  const id = getId(input)
  if (!id) throw new Error('Invalid YouTube URL or video ID')

  const format = ['audio', 'mp3'].includes(type) ? 'mp3' : ['video', 'mp4'].includes(type) ? 'mp4' : null
  if (!format) throw new Error('Type must be "audio", "video", "mp3" or "mp4"')

  const disponibles = format === 'mp3' ? ['320', '256', '128'] : ['1080', '720', '360', '240', '144']
  const q = quality == null ? disponibles : [String(quality).replace(/[^\d]/g, '')]
  if (quality != null && !disponibles.includes(q[0])) throw new Error(`Unsupported ${format} quality. Available: ${disponibles.join(', ')}`)

  const errores = []
  for (const calidad of q) {
    try {
      const archivo = await convert(id, format, calidad, signal)
      const size = await getFileSize(archivo.url, signal).catch(() => null)
      return {
        id,
        type: format === 'mp3' ? 'audio' : 'video',
        format,
        quality: format === 'mp3' ? `${calidad} kbps` : `${calidad}p`,
        size,
        ...archivo
      }
    } catch (error) {
      if (signal?.aborted) throw error
      errores.push(`${calidad}: ${error?.message ?? error}`)
    }
  }

  throw new Error(errores.at(-1) ?? 'Unable to convert video')
}

async function convert(id, format, quality, signal) {
  const key = await getKey(id, signal)
  const body = new URLSearchParams({
    link: `https://youtu.be/${id}`,
    format,
    audioBitrate: format === 'mp4' ? '128' : String(quality),
    videoQuality: format === 'mp3' ? '720' : String(quality),
    filenameStyle: 'pretty',
    vCodec: 'h264'
  })

  const response = await fetch('https://cnv.cx/v2/converter', {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/x-www-form-urlencoded',
      key,
      origin: 'https://frame.y2meta-uk.com',
      referer: 'https://frame.y2meta-uk.com/',
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36'
    },
    body,
    signal: combineSignal(signal, 120000)
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message ?? `Converter responded ${response.status}`)
  if (!data?.url) throw new Error('Converter did not return a download URL')

  return {
    url: normalizeUrl(data.url),
    filename: data.filename ?? `YouTube.${format}`,
    status: data.status ?? null
  }
}

async function getKey(id, signal) {
  const response = await fetch(`https://cnv.cx/v2/sanity/key?id=${encodeURIComponent(id)}`, {
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      origin: 'https://frame.y2meta-uk.com',
      referer: 'https://frame.y2meta-uk.com/',
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36'
    },
    signal: combineSignal(signal, 30000)
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message ?? `Key server responded ${response.status}`)
  if (!data?.key) throw new Error('Unable to obtain conversion key')
  return data.key
}

async function getVideo(input, { signal } = {}) {
  const id = getId(input)
  if (!id) throw new Error('Invalid YouTube URL or video ID')

  const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, {
    signal: combineSignal(signal, 30000)
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(`Unable to obtain video information (${response.status})`)

  return {
    id,
    title: data.title ?? null,
    channel: data.author_name ?? null,
    channelUrl: data.author_url ?? null,
    thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    width: data.width ?? null,
    height: data.height ?? null,
    url: `https://www.youtube.com/watch?v=${id}`
  }
}

async function getFileSize(url, signal) {
  const head = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    signal: combineSignal(signal, 30000)
  }).catch(() => null)

  const length = Number(head?.headers?.get('content-length'))
  if (length > 0) return length

  const response = await fetch(url, {
    headers: { range: 'bytes=0-0' },
    redirect: 'follow',
    signal: combineSignal(signal, 30000)
  }).catch(() => null)

  await response?.body?.cancel().catch(() => null)

  const total = Number(response?.headers?.get('content-range')?.match(/\/(\d+)$/)?.[1])
  if (total > 0) return total

  const size = Number(response?.headers?.get('content-length'))
  return size > 0 ? size : null
}

function normalizeUrl(url) {
  try {
    if (url.startsWith('https://conv.mp3youtube.cc/download/')) return url
    const parsed = new URL(url)
    let details = parsed.search.slice(1)
    if (details.startsWith('id=')) details = details.slice(3)
    return details ? `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}/?id=${details}` : url
  } catch {
    return url
  }
}

function getId(value = '') {
  const text = String(value).trim()
  return text.match(/(?:youtu\.be\/|[?&]v=|shorts\/|live\/|embed\/)([\w-]{11})/i)?.[1] ?? (/^[\w-]{11}$/.test(text) ? text : null)
}

function combineSignal(signal, timeout) {
  const timer = AbortSignal.timeout(timeout)
  return signal ? AbortSignal.any([signal, timer]) : timer
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes, unit = 0
  while (value >= 1024 && unit < units.length - 1) value /= 1024, unit++
  return `${value.toFixed(unit >= 3 ? 2 : 1)} ${units[unit]}`
}

export { download, convert, getVideo, getKey, getId, getFileSize, formatBytes }
export default { download, getVideo }