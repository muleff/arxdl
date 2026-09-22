import crypto from 'crypto'
let sesion
async function search(query, { limit = 10, signal } = {}) {
  const q = query?.trim()
  if (!q) throw new Error('Search query is empty')
  const data = await post('search', { query: q }, { signal })
  const resultados = new Map()
  for (const nodo of recorrer(data)) {
    for (const video of [parseVideo(nodo.videoWithContextRenderer ?? nodo.videoRenderer), parseShort(nodo.shortsLockupViewModel)]) {
      if (!video || resultados.has(video.id)) continue
      resultados.set(video.id, video)
      if (resultados.size >= limit) return [...resultados.values()]
    }
  }
  return [...resultados.values()]
}

async function getVideo(videoId, { signal } = {}) {
  const id = getId(videoId)
  if (!id) throw new Error('Invalid YouTube video ID')
  const params = { videoId: id, contentCheckOk: true, racyCheckOk: true }
  let data = await fallback(() => post('player', params, { signal }))
  if (!data?.videoDetails?.title || data?.playabilityStatus?.status === 'LOGIN_REQUIRED') {
    const alt = await fallback(() => post('player', params, {
      signal,
      cliente: {
        clientName: 'ANDROID_TESTSUITE',
        clientVersion: '1.9',
        clientNumber: 30,
        userAgent: 'com.google.android.youtube/19.17.34 (Linux; U; Android 14) gzip'
      }
    }))
    if (alt?.videoDetails) data = alt
  }
  if (!data?.videoDetails) throw new Error(`Unable to get information for video ${id}`)
  const d = data.videoDetails
  const m = data.microformat?.playerMicroformatRenderer ?? {}
  const durationSeconds = Number(d.lengthSeconds ?? m.lengthSeconds)
  return {
    id: d.videoId ?? id,
    title: d.title ?? null,
    description: d.shortDescription ?? null,
    channel: d.author ?? m.ownerChannelName ?? null,
    channelId: d.channelId ?? m.externalChannelId ?? null,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    views: d.viewCount ?? m.viewCount ?? null,
    thumbnails: thumbnails(d.thumbnail?.thumbnails),
    published: m.publishDate ?? null,
    uploaded: m.uploadDate ?? null,
    url: `https://www.youtube.com/watch?v=${id}`
  }
}

async function download(input, { type = 'audio', quality, signal } = {}) {
  const id = getId(input)
  if (!id) throw new Error('Invalid YouTube URL or video ID')
  if (!['audio', 'video'].includes(type)) throw new Error('Type must be "audio" or "video"')
  const disponibles = type === 'video' ? ['360', '480', '720', '1080'] : ['128', '320']
  let calidades
  if (quality != null) {
    const q = String(quality).match(/\d+/)?.[0]
    if (!disponibles.includes(q)) throw new Error(`Unsupported ${type} quality. Available: ${disponibles.join(', ')}`)
    calidades = [q]
  } else calidades = shuffle(disponibles)
  const errores = []
  for (const q of calidades) {
    try {
      const archivo = await savetube(id, type, q, signal)
      const size = await getFileSize(archivo.url, signal).catch(() => null)
      return { id, ...archivo, size }
    } catch (error) {
      if (signal?.aborted) throw error
      errores.push(`${q}: ${error?.message ?? String(error)}`)
    }
  }
  throw new Error(errores.at(-1) ?? 'Unable to download video')
}

async function savetube(id, type, quality, signal) {
  const cdn = await getCdn(signal)
  const info = await postJson(`https://${cdn}/v2/info`, {
    url: `https://www.youtube.com/watch?v=${id}`
  }, combineSignal(signal, 60000))
  if (!info?.status || !info?.data) throw new Error(info?.message ?? 'Unable to process the video')
  const meta = decrypt(info.data)
  const dl = await postJson(`https://${cdn}/download`, {
    downloadType: type,
    quality: String(quality),
    key: meta.key
  }, combineSignal(signal, 300000))
  const url = dl?.data?.downloadUrl
  if (typeof url !== 'string' || url.includes('googlevideo.com')) throw new Error(`CDN URL unavailable for quality ${quality}`)
  const format = type === 'video' ? 'mp4' : 'mp3'
  return {
    url,
    title: meta.title || 'YouTube',
    type,
    format,
    quality: type === 'video' ? `${quality}p` : `${quality} kbps`,
    filename: `${cleanFilename(meta.title)}.${format}`
  }
}

async function getCdn(signal) {
  const response = await fetch('https://media.savetube.vip/api/random-cdn', {
    headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
    signal: combineSignal(signal, 30000)
  })
  if (!response.ok) throw new Error(`SaveTube responded ${response.status}`)
  const data = await response.json().catch(() => null)
  if (!data?.cdn) throw new Error('Unable to obtain CDN')
  return data.cdn
}

function decrypt(data) {
  const raw = Buffer.from(data, 'base64')
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex'), raw.subarray(0, 16))
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString('utf8'))
}

async function post(endpoint, body, { signal, cliente } = {}) {
  const config = await configure(signal)
  const client = cliente ?? { clientName: 'MWEB', clientVersion: config.clientVersion, clientNumber: config.clientNumber }
  const url = new URL(`/youtubei/v1/${endpoint}`, 'https://m.youtube.com')
  url.searchParams.set('prettyPrint', 'false')
  url.searchParams.set('key', config.apiKey)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': client.userAgent ?? 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
      'accept-language': 'es-US',
      'x-youtube-client-name': String(client.clientNumber ?? config.clientNumber),
      'x-youtube-client-version': client.clientVersion,
      ...(config.visitorData && { 'x-goog-visitor-id': config.visitorData }),
      ...(client.clientName === 'MWEB' && { origin: 'https://m.youtube.com', referer: 'https://m.youtube.com/' })
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: client.clientName,
          clientVersion: client.clientVersion,
          hl: 'es-US',
          gl: 'HN',
          ...(config.visitorData && { visitorData: config.visitorData })
        }
      },
      ...body
    }),
    signal: combineSignal(signal, 30000)
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.error) throw new Error(data?.error?.message ?? `YouTube responded ${response.status}`)
  return data
}

async function configure(signal) {
  sesion ??= createSession(signal).catch(error => {
    sesion = null
    throw error
  })
  return sesion
}

async function createSession(signal) {
  const response = await fetch('https://m.youtube.com/?hl=es-US&gl=HN', {
    headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
      'accept-language': 'es-US'
    },
    signal: combineSignal(signal, 30000)
  })
  if (!response.ok) throw new Error(`YouTube responded ${response.status}`)
  const html = await response.text()
  const apiKey = configValue(html, 'INNERTUBE_API_KEY')
  const clientVersion = configValue(html, 'INNERTUBE_CONTEXT_CLIENT_VERSION') ?? configValue(html, 'INNERTUBE_CLIENT_VERSION')
  if (!apiKey || !clientVersion) throw new Error('Unable to obtain YouTube configuration')
  return {
    apiKey,
    clientVersion,
    clientNumber: configValue(html, 'INNERTUBE_CONTEXT_CLIENT_NAME') ?? 2,
    visitorData: configValue(html, 'VISITOR_DATA')
  }
}

function configValue(html, key) {
  const match = html.match(new RegExp(`"${key}":(?:"((?:\\\\.|[^"])*)"|(-?\\d+(?:\\.\\d+)?))`))
  if (match?.[1] !== undefined) {
    try { return JSON.parse(`"${match[1]}"`) } catch { return null }
  }
  return match?.[2] !== undefined ? Number(match[2]) : null
}

function* recorrer(value) {
  if (!value || typeof value !== 'object') return
  yield value
  for (const child of Array.isArray(value) ? value : Object.values(value)) yield* recorrer(child)
}

function parseVideo(r) {
  if (!r?.videoId) return null
  const runs = r.shortBylineText?.runs ?? r.ownerText?.runs ?? []
  const channel = runs.find(x => x?.navigationEndpoint?.browseEndpoint?.browseId) ?? runs.at(0)
  return {
    id: r.videoId,
    title: text(r.headline) ?? text(r.title),
    channel: channel?.text ?? text(r.shortBylineText) ?? text(r.ownerText),
    channelId: channel?.navigationEndpoint?.browseEndpoint?.browseId ?? r.channelThumbnail?.channelThumbnailWithLinkRenderer?.navigationEndpoint?.browseEndpoint?.browseId ?? null,
    duration: text(r.lengthText),
    views: text(r.shortViewCountText) ?? text(r.viewCountText),
    published: text(r.publishedTimeText),
    thumbnail: thumbnails(r.thumbnail?.thumbnails).at(0)?.url ?? null,
    url: `https://www.youtube.com/watch?v=${r.videoId}`
  }
}

function parseShort(r) {
  const id = r?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? r?.inlinePlayerData?.onVisible?.innertubeCommand?.watchEndpoint?.videoId
  if (!id) return null
  return {
    id,
    title: r.overlayMetadata?.primaryText?.content ?? r.accessibilityText ?? null,
    channel: r.belowThumbnailMetadata?.primaryText?.content ?? null,
    channelId: r.belowThumbnailMetadata?.avatar?.avatarViewModel?.endpoint?.innertubeCommand?.browseEndpoint?.browseId ?? null,
    duration: null,
    views: r.overlayMetadata?.secondaryText?.content ?? null,
    published: r.belowThumbnailMetadata?.secondaryText?.content ?? null,
    thumbnail: thumbnails(r.thumbnail?.sources ?? r.thumbnailViewModel?.thumbnailViewModel?.image?.sources).at(0)?.url ?? null,
    url: `https://www.youtube.com/shorts/${id}`
  }
}

function text(value) {
  return value?.runs?.map(x => x.text ?? '').join('') ?? value?.simpleText ?? value?.content ?? null
}

function thumbnails(sources) {
  return [...(sources ?? [])].sort((a, b) => (b?.width ?? 0) - (a?.width ?? 0))
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
    headers: {
      range: 'bytes=0-0',
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36'
    },
    redirect: 'follow',
    signal: combineSignal(signal, 30000)
  }).catch(() => null)
  await response?.body?.cancel().catch(() => null)
  const total = Number(response?.headers?.get('content-range')?.match(/\/(\d+)$/)?.[1])
  if (total > 0) return total
  if (response?.status === 200) {
    const length = Number(response.headers.get('content-length'))
    if (length > 0) return length
  }
  return null
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

function fallback(request) {
  return request().catch(error => {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error
    return null
  })
}

function combineSignal(signal, timeout) {
  const timer = AbortSignal.timeout(timeout)
  return signal ? AbortSignal.any([signal, timer]) : timer
}

function getId(value = '') {
  const text = String(value).trim()
  return text.match(/(?:youtu\.be\/|[?&]v=|shorts\/|live\/|embed\/)([\w-]{11})/i)?.[1] ?? (/^[\w-]{11}$/.test(text) ? text : null)
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes, unit = 0
  while (value >= 1024 && unit < units.length - 1) value /= 1024, unit++
  return `${value.toFixed(unit >= 3 ? 2 : 1)} ${units[unit]}`
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return null
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export { search, getVideo, download, getId, getFileSize, formatBytes, formatDuration }
export default { search, getVideo, download }