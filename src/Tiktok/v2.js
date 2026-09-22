function timeout(signal, ms) {
  const timer = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timer]) : timer
}

function decode(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(Number(x)))
    .replace(/&amp;|&#0*38;/gi, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim()
}

function number(value) {
  const digits = String(value ?? '').replace(/[^\d]/g, '')
  return digits ? Number(digits) : 0
}

async function resolve(input, signal) {
  let current
  try { current = new URL(String(input).trim()) } catch { throw new Error('Invalid TikTok URL') }
  if (!/(^|\.)tiktok\.com$/i.test(current.hostname)) throw new Error('Invalid TikTok URL')

  for (let i = 0; i < 5; i++) {
    if (/^(www\.)?tiktok\.com$/i.test(current.hostname) && /\/(?:video|photo)\/\d+/.test(current.pathname)) break
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36' },
      signal: timeout(signal, 20000)
    })
    await response.body?.cancel().catch(() => null)
    const location = response.headers.get('location')
    if (!location) break
    current = new URL(location, current)
  }

  const match = current.pathname.match(/^(\/@[^/]+\/(?:video|photo)\/(\d+))/)
  if (!match) throw new Error('Unable to resolve TikTok URL')
  return { target: `https://www.tiktok.com${match[1]}`, id: match[2] }
}

async function download(input, { signal } = {}) {
  const { target, id } = await resolve(input, signal)
  const base = 'https://ttkdownloader.com'
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    origin: base,
    referer: `${base}/`
  }

  const home = await fetch(`${base}/`, { headers, signal: timeout(signal, 30000) })
  const html = await home.text()
  const nonce = html.match(/name="tiktok_downloader_nonce" value="([a-f0-9]+)"/)?.[1]
  if (!nonce) throw new Error('TTKDownloader: nonce unavailable')

  const response = await fetch(`${base}/`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tiktok_downloader_nonce: nonce, _wp_http_referer: '/', tiktok_url: target }),
    redirect: 'follow',
    signal: timeout(signal, 60000)
  })

  const body = (await response.text()).replace(/&#0*38;|&amp;/g, '&')
  const links = {}
  const re = /admin-post\.php\?action=tiktok_force_download&key=([a-f0-9]+)&q=(sd|hd)&_wpnonce=([a-f0-9]+)/g
  let match

  while ((match = re.exec(body))) {
    links[match[2]] = `${base}/wp-admin/admin-post.php?action=tiktok_force_download&key=${match[1]}&q=${match[2]}&_wpnonce=${match[3]}`
  }

  if (!links.hd && !links.sd) {
    const error = decode(body.match(/class="tt-error">([^<]+)</)?.[1])
    throw new Error(error ? `TTKDownloader: ${error}` : 'TTKDownloader: download URL unavailable')
  }

  const titulo = decode(body.match(/<div class="tt-details">\s*<h3>([\s\S]*?)<\/h3>/)?.[1]) || null
  const author = decode(body.match(/<strong>Author:<\/strong>([^<]+)</)?.[1])
  const authorMatch = author.match(/^(.*?)\s*\(@([^)]+)\)$/)
  const cover = body.match(/<img[^>]*class="tt-cover"[^>]*>/)?.[0] ?? ''
  const stats = body.match(/<div class="tt-stats">([\s\S]*?)<\/div>/)?.[1] ?? ''

  return {
    id,
    tipo: 'video',
    titulo,
    portada: cover.match(/src="([^"]+)"/)?.[1] ?? null,
    autor: { usuario: authorMatch?.[2] ?? null, nombre: authorMatch?.[1] ?? author ?? null, avatar: null },
    estadisticas: {
      vistas: number(stats.match(/▶\s*([\d.,]+)/)?.[1]),
      likes: number(stats.match(/❤\s*([\d.,]+)/)?.[1]),
      comentarios: number(stats.match(/💬\s*([\d.,]+)/)?.[1]),
      compartidos: number(stats.match(/🔄\s*([\d.,]+)/)?.[1]),
      favoritos: 0
    },
    musica: { titulo: null, autor: null, url: null },
    datos: { tipo: 'video', archivo: `${id}.mp4`, extension: '.mp4', calidad: links.hd ? 'HD' : 'SD', url: links.hd || links.sd }
  }
}

export { download }
export default { download }