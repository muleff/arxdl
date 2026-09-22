let session

async function search(query, { limit = 10, signal } = {}) {
  const q = query?.trim()
  if (!q) throw new Error('Search query is empty')
  const data = await post('search', { query: q }, { signal })
  const results = new Map()

  for (const node of walk(data)) {
    for (const video of [parseVideo(node.videoWithContextRenderer ?? node.videoRenderer), parseShort(node.shortsLockupViewModel)]) {
      if (!video || results.has(video.id)) continue
      results.set(video.id, video)
      if (results.size >= limit) return [...results.values()]
    }
  }

  return [...results.values()]
}

async function getVideo(input, { signal } = {}) {
  const id = getId(input)
  if (!id) throw new Error('Invalid YouTube video ID')

  const params = { videoId: id, contentCheckOk: true, racyCheckOk: true }
  let data = await fallback(() => post('player', params, { signal }))

  if (!data?.videoDetails?.title || data?.playabilityStatus?.status === 'LOGIN_REQUIRED') {
    const alt = await fallback(() => post('player', params, {
      signal,
      client: {
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
    duration: formatDuration(durationSeconds),
    views: d.viewCount ?? m.viewCount ?? null,
    thumbnails: thumbnails(d.thumbnail?.thumbnails),
    thumbnail: thumbnails(d.thumbnail?.thumbnails).at(0)?.url ?? null,
    published: m.publishDate ?? null,
    uploaded: m.uploadDate ?? null,
    url: `https://www.youtube.com/watch?v=${id}`
  }
}

function getId(value = '') {
  const text = String(value).trim()
  return text.match(/(?:youtu\.be\/|[?&]v=|shorts\/|live\/|embed\/)([\w-]{11})/i)?.[1] ?? (/^[\w-]{11}$/.test(text) ? text : null)
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

async function post(endpoint, body, { signal, client } = {}) {
  const config = await configure(signal)
  const c = client ?? {
    clientName: 'MWEB',
    clientVersion: config.clientVersion,
    clientNumber: config.clientNumber
  }

  const url = new URL(`/youtubei/v1/${endpoint}`, 'https://m.youtube.com')
  url.searchParams.set('prettyPrint', 'false')
  url.searchParams.set('key', config.apiKey)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': c.userAgent ?? 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
      'accept-language': 'es-US',
      'x-youtube-client-name': String(c.clientNumber ?? config.clientNumber),
      'x-youtube-client-version': c.clientVersion,
      ...(config.visitorData && { 'x-goog-visitor-id': config.visitorData }),
      ...(c.clientName === 'MWEB' && {
        origin: 'https://m.youtube.com',
        referer: 'https://m.youtube.com/'
      })
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: c.clientName,
          clientVersion: c.clientVersion,
          hl: 'es-US',
          gl: 'HN',
          ...(config.visitorData && { visitorData: config.visitorData })
        }
      },
      ...body
    }),
    signal: withTimeout(signal, 30000)
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || data?.error) throw new Error(data?.error?.message ?? `YouTube responded ${response.status}`)
  return data
}

async function configure(signal) {
  session ??= createSession(signal).catch(error => {
    session = null
    throw error
  })
  return session
}

async function createSession(signal) {
  const response = await fetch('https://m.youtube.com/?hl=es-US&gl=HN', {
    headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
      'accept-language': 'es-US'
    },
    signal: withTimeout(signal, 30000)
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

function* walk(value) {
  if (!value || typeof value !== 'object') return
  yield value
  for (const child of Array.isArray(value) ? value : Object.values(value)) yield* walk(child)
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

function fallback(request) {
  return request().catch(error => {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error
    return null
  })
}

function withTimeout(signal, timeout) {
  const timer = AbortSignal.timeout(timeout)
  return signal ? AbortSignal.any([signal, timer]) : timer
}

export { search, getVideo, getId, formatBytes, formatDuration }
export default { search, getVideo, getId, formatBytes, formatDuration }