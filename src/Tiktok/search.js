import { Impit } from 'impit'
import xbogus from 'xbogus'

const BASE = 'https://www.tiktok.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const GEO = { region: 'ES', language: 'es', app_language: 'es', browser_language: 'es-ES', tz: 'Europe/Madrid' }
const client = new Impit({ browser: 'chrome', headers: { 'user-agent': UA } })
const DEVICE_ID = Array.from({ length: 19 }, (_, i) => i ? Math.floor(Math.random() * 10) : Math.floor(Math.random() * 9) + 1).join('')
const STOPWORDS = new Set([
  'a','al','ante','con','de','del','el','ella','ellos','en','es','ese','esa','eso','esta','este','esto','la','las','le','les','lo','los','mi','mis','muy','no','o','para','pero','por','que',
  'se','si','sin','su','sus','te','tu','tus','un','una','unas','unos','y','ya','yo','the','of','and','to','in','for','my','on','with','is','it','at','by','or','an','me','i'
])

let session = null
let warming = null
let headersCache = null

function fail(message, statusCode) {
  const error = new Error(message)
  if (statusCode) error.statusCode = statusCode
  return error
}

function timeout(signal, ms = 30000) {
  const timer = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timer]) : timer
}

function absorbCookies(response) {
  if (!session) return
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(';')[0]
    const index = pair.indexOf('=')
    if (index > 0) session.jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  }
  session.cookie = [...session.jar].map(([key, value]) => `${key}=${value}`).join('; ')
}

function warmCookies() {
  if (warming) return warming

  warming = (async () => {
    session = { jar: new Map(), cookie: '', expiresAt: Date.now() + 600000 }
    const response = await client.fetch(`${BASE}/`, { signal: AbortSignal.timeout(30000) })
    absorbCookies(response)
    return session
  })().finally(() => {
    warming = null
  })

  return warming
}

async function getCookies() {
  if (session?.expiresAt > Date.now()) return session
  return warmCookies()
}

async function getJson(path, tag, signal) {
  const { cookie } = await getCookies()
  const unsigned = `${BASE}${path}`
  const url = `${unsigned}${path.includes('?') ? '&' : '?'}X-Bogus=${encodeURIComponent(xbogus(unsigned, UA))}`

  const response = await client.fetch(url, {
    headers: {
      cookie,
      referer: `${BASE}/tag/${encodeURIComponent(tag)}`,
      accept: 'application/json, text/plain, */*'
    },
    signal: timeout(signal)
  })

  absorbCookies(response)

  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }

  if (!response.ok || !json || json.status_code) {
    session = null
    const message = json?.status_msg || json?.status_code || `HTTP ${response.status}`
    throw new Error(`TikTok rechazó la petición (${url.split('?')[0]}): ${message}`)
  }

  return json
}

function pickDownloadUrl(video) {
  for (const bitrate of video?.bitrateInfo ?? []) {
    for (const url of bitrate?.PlayAddr?.UrlList ?? bitrate?.play_addr?.url_list ?? []) {
      if (url.includes('www.tiktok.com/aweme/v1/play')) return url
    }
  }
  return null
}

function normalize(item) {
  const author = item.author ?? item.authorInfo ?? {}
  const stats = item.statsV2 ?? item.stats ?? {}
  const video = item.video ?? {}
  const music = item.music ?? {}
  const usuario = author.uniqueId ?? author.unique_id ?? null
  const id = item.id ?? item.aweme_id ?? null
  const timestamp = Number(item.createTime ?? item.create_time) || 0
  const definition = String(video.definition ?? '').toLowerCase()

  return {
    id,
    titulo: item.desc ?? item.title ?? null,
    url: usuario && id ? `${BASE}/@${usuario}/video/${id}` : null,
    duracion: Number(video.duration ?? item.duration) || 0,
    video: pickDownloadUrl(video) ?? video.downloadAddr ?? video.playAddr ?? video.play_addr?.url_list?.[0] ?? null,
    calidad: /1080|720/.test(definition) ? 'HD' : 'SD',
    publicado: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    autor: {
      usuario,
      nombre: author.nickname ?? null,
      avatar: author.avatarLarger ?? author.avatarMedium ?? author.avatarThumb ?? null,
      verificado: Boolean(author.verified)
    },
    estadisticas: {
      vistas: Number(stats.playCount ?? stats.play_count) || 0,
      likes: Number(stats.diggCount ?? stats.digg_count) || 0,
      comentarios: Number(stats.commentCount ?? stats.comment_count) || 0,
      compartidos: Number(stats.shareCount ?? stats.share_count) || 0,
      favoritos: Number(stats.collectCount ?? stats.collect_count) || 0
    },
    musica: {
      titulo: music.title ?? null,
      autor: music.authorName ?? null,
      url: music.playUrl ?? null
    }
  }
}

function stripDiacritics(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

async function fetchHashtag(tag, count, cursor, signal) {
  const detail = await getJson(
    `/api/challenge/detail/?challengeName=${encodeURIComponent(tag)}&language=${GEO.language}&aid=1988`,
    tag,
    signal
  )

  const challenge = detail?.challengeInfo?.challenge
  if (!challenge?.id) return null

  const params = new URLSearchParams({
    aid: '1988',
    app_language: GEO.app_language,
    app_name: 'tiktok_web',
    browser_language: GEO.browser_language,
    browser_name: 'Mozilla',
    browser_online: 'true',
    browser_platform: 'Win32',
    browser_version: UA,
    challengeID: challenge.id,
    channel: 'tiktok_web',
    count: String(count),
    coverFormat: '2',
    cursor: String(cursor),
    device_id: DEVICE_ID,
    device_platform: 'web_pc',
    focus_state: 'true',
    from_page: 'hashtag',
    history_len: '1',
    is_fullscreen: 'false',
    is_page_visible: 'true',
    language: GEO.language,
    os: 'windows',
    priority_region: '',
    region: GEO.region,
    screen_height: '540',
    screen_width: '960',
    tz_name: GEO.tz,
    webcast_language: GEO.language
  })

  const json = await getJson(`/api/challenge/item_list/?${params}`, tag, signal)
  const items = Array.isArray(json?.itemList ?? json?.item_list) ? json.itemList ?? json.item_list : []
  const resultados = items.filter(item => item && item.desc !== undefined).map(normalize)

  return {
    tag,
    resultados,
    cursor: Number(json.cursor) || cursor + resultados.length,
    hayMas: Boolean(json.hasMore)
  }
}

function derivedTags(query, exact) {
  const words = query
    .toLowerCase()
    .replace(/#/g, ' ')
    .split(/\s+/)
    .map(word => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(word => word.length >= 3 && !STOPWORDS.has(word))

  const candidates = []

  if (words.length >= 2) {
    candidates.push(words.join(''))
    for (let i = 0; i + 1 < words.length; i++) candidates.push(words[i] + words[i + 1])
  }

  candidates.push(...[...words].sort((a, b) => b.length - a.length))

  const seen = new Set([exact, stripDiacritics(exact)])
  const result = []

  for (const raw of candidates) {
    for (const tag of [raw, stripDiacritics(raw)]) {
      if (seen.has(tag)) continue
      seen.add(tag)
      result.push(tag)
    }
  }

  return result
}

async function search(keywords, options = {}) {
  const query = String(keywords ?? '').trim()
  if (!query) throw fail('Debes enviar una búsqueda.', 400)

  const tag = query.replace(/#/g, '').replace(/\s+/g, '').toLowerCase()
  const count = Math.min(Math.max(Number(options.count) || 12, 1), 30)
  const cursor = Math.max(Number(options.cursor) || 0, 0)
  const { signal, fallbackGate } = options

  const variants = [tag]
  const stripped = stripDiacritics(tag)
  if (stripped !== tag) variants.push(stripped)

  let best = null

  for (const variant of variants) {
    const attempt = await fetchHashtag(variant, count, cursor, signal)
    if (!attempt?.resultados.length) continue
    if (!best || attempt.resultados.length > best.resultados.length) best = attempt
    if (best.resultados.length >= count || best.hayMas) break
  }

  let aproximado = false

  if (!best) {
    for (const derived of derivedTags(query, tag).slice(0, 8)) {
      const attempt = await fetchHashtag(derived, count, cursor, signal)
      if (!attempt?.resultados.length) continue
      best = attempt
      aproximado = true
      break
    }
  }

  if (!best) throw fail(`No se encontraron videos para #${tag} ni hashtags parecidos en TikTok.`, 404)

  if (aproximado && typeof fallbackGate === 'function' && await fallbackGate()) {
    const error = new Error(`hashtag: #${best.tag} era aproximado`)
    error.name = 'AbortError'
    throw error
  }

  return {
    busqueda: query,
    hashtag: best.tag,
    aproximado,
    total: best.resultados.length,
    cursor: best.cursor,
    hayMas: best.hayMas,
    resultados: best.resultados
  }
}

function sessionCookie() {
  return session?.cookie ?? ''
}

async function downloadHeaders() {
  if (headersCache?.expiresAt > Date.now()) return headersCache.headers

  const current = await getCookies().catch(() => null)
  const headers = current?.cookie ? {
    cookie: current.cookie,
    'user-agent': UA,
    referer: `${BASE}/`,
    __impersonate: 'chrome'
  } : {
    'user-agent': UA,
    referer: `${BASE}/`,
    __impersonate: 'chrome'
  }

  headersCache = { headers, expiresAt: Date.now() + 600000 }
  return headers
}

downloadHeaders.skipScraperTracking = true
sessionCookie.skipScraperTracking = true

export {
  search,
  sessionCookie,
  downloadHeaders,
  normalize,
  pickDownloadUrl,
  UA
}

export default {
  search,
  sessionCookie,
  downloadHeaders
}