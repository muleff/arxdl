import { gotScraping } from 'got-scraping'
import * as cheerio from 'cheerio'

function cookies(setCookie) {
  if (!setCookie) return ''
  return (Array.isArray(setCookie) ? setCookie : [setCookie]).map(x => x.split(';')[0]).join('; ')
}

function decode(value) {
  return String(value ?? '').replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#38;/g, '&').replace(/\\u002F/gi, '/').replace(/\\\//g, '/')
}

function extract(html, base = 'https://vitalmark.ca/') {
  const found = { video: null, audio: null }, urls = new Set(), re = /https?:\/\/[^\s"'<>\\]+/gi
  const $ = cheerio.load(html, { decodeEntities: false })

  $('[href],[data-href],[data-url],[data-src],[data-download]').each((_, el) => {
    const e = $(el)
    for (const attr of ['href', 'data-href', 'data-url', 'data-src', 'data-download']) {
      let value = e.attr(attr)
      if (!value) continue
      value = decode(value.trim())
      if (/^https?:\/\//i.test(value)) urls.add(value)
      else if (value.startsWith('//')) urls.add(`https:${value}`)
      else if (value.startsWith('/')) urls.add(base.replace(/\/$/, '') + value)
    }
  })

  for (const url of html.match(re) ?? []) urls.add(decode(url))
  $('script').each((_, el) => {
    const script = ($(el).html() ?? '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/')
    for (const url of script.match(re) ?? []) urls.add(decode(url))
  })

  for (const raw of urls) {
    const url = decode(raw)
    if (!/tikcdn\.beubagah\.com/i.test(url) && !/format=(mp4|mp3)/i.test(url)) continue
    if (!found.video && (/format=mp4/i.test(url) || /\.mp4(?:\?|&|$)/i.test(url))) found.video = url
    else if (!found.audio && (/format=mp3/i.test(url) || /\.mp3(?:\?|&|$)/i.test(url))) found.audio = url
  }
  return found
}

async function download(input, { signal } = {}) {
  let url
  try { url = new URL(String(input).trim()) } catch { throw new Error('Invalid TikTok URL') }
  if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) throw new Error('Invalid TikTok URL')

  const agents = [
    'Mozilla/5.0 (Android 16; Mobile; rv:155.0) Gecko/155.0 Firefox/155.0',
    'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]
  const ua = agents[Math.floor(Math.random() * agents.length)]

  const init = await gotScraping.get('https://vitalmark.ca/', {
    headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'es-US,es;q=0.9,en;q=0.8' },
    throwHttpErrors: false,
    signal
  })

  const cookie = cookies(init.headers['set-cookie'])
  const csrf = cheerio.load(init.body)('input[name="_csrf"]').val()
  if (!csrf) throw new Error('Vitalmark: CSRF unavailable')

  const response = await gotScraping.post('https://vitalmark.ca/', {
    form: { _csrf: csrf, url: url.href },
    headers: {
      'user-agent': ua,
      referer: 'https://vitalmark.ca/',
      origin: 'https://vitalmark.ca',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'es-US,es;q=0.9,en;q=0.8',
      ...(cookie && { cookie })
    },
    followRedirect: true,
    maxRedirects: 10,
    throwHttpErrors: false,
    signal
  })

  let current = response.url || 'https://vitalmark.ca/'
  let result = extract(response.body ?? '', current)

  if (!result.video && current !== 'https://vitalmark.ca/') {
    const retry = await gotScraping.get(current, {
      headers: { 'user-agent': ua, referer: 'https://vitalmark.ca/', ...(cookie && { cookie }) },
      throwHttpErrors: false,
      signal
    })
    result = extract(retry.body ?? '', current)
  }

  if (!result.video) throw new Error('Vitalmark: download URL unavailable')

  return {
    id: url.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? null,
    tipo: 'video',
    titulo: 'TikTok',
    portada: null,
    autor: { usuario: null, nombre: null, avatar: null },
    estadisticas: { vistas: 0, likes: 0, comentarios: 0, compartidos: 0, favoritos: 0 },
    musica: { titulo: null, autor: null, url: result.audio },
    datos: { tipo: 'video', archivo: 'tiktok.mp4', extension: '.mp4', calidad: 'SD', url: result.video }
  }
}

export { download }
export default { download }