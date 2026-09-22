import axios from 'axios'
import https from 'https'

function timeout(signal, ms) {
  const timer = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timer]) : timer
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function download(input, { signal } = {}) {
  let url
  try { url = new URL(String(input).trim()) } catch { throw new Error('Invalid TikTok URL') }
  if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) throw new Error('Invalid TikTok URL')

  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true })
  const headers = {
    'user-agent': 'Mozilla/5.0 (Android 16; Mobile; rv:154.0) Gecko/154.0 Firefox/154.0',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'es-US,es;q=0.9',
    origin: 'https://ttsave.net',
    referer: 'https://ttsave.net/'
  }

  const home = await axios.get('https://ttsave.net/', {
    headers,
    httpsAgent: agent,
    signal: timeout(signal, 15000),
    validateStatus: () => true
  })

  const cookie = home.headers['set-cookie']?.map(x => x.split(';')[0]).join('; ') ?? ''
  const nonce = String(home.data).match(/"nonce"\s*:\s*"([a-f0-9]+)"/i)?.[1] ?? String(home.data).match(/nonce=["']([a-f0-9]+)["']/i)?.[1]
  if (!nonce) throw new Error('TTSave: nonce unavailable')

  const ajaxHeaders = {
    ...headers,
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest',
    ...(cookie && { cookie })
  }

  const fetchData = await axios.post(
    'https://ttsave.net/wp-admin/admin-ajax.php',
    new URLSearchParams({ action: 'tktdl_fetch', nonce, url: url.href }).toString(),
    { headers: ajaxHeaders, httpsAgent: agent, signal: timeout(signal, 15000), validateStatus: () => true }
  )

  if (!fetchData.data?.success) throw new Error('TTSave could not process the URL')

  const data = fetchData.data.data
  const token = data.token
  const nextNonce = data.nonce
  const author = data.nickname || 'Unknown'
  const title = String(data.title || 'TikTok').replace(/#[\wñáéíóú]+/gi, '').trim() || 'TikTok'
  const encoded = encodeURIComponent(url.href)

  const audio = `https://ttsave.net/wp-admin/admin-ajax.php?action=tktdl_download_mp3&nonce=${nextNonce}&token=${token}&tiktok_url=${encoded}`
  const avatar = `https://ttsave.net/wp-admin/admin-ajax.php?action=tktdl_download_avatar&nonce=${nextNonce}&token=${token}&tiktok_url=${encoded}`
  const thumbnail = `https://ttsave.net/wp-admin/admin-ajax.php?action=tktdl_download_thumb&nonce=${nextNonce}&token=${token}&tiktok_url=${encoded}`

  const job = await axios.post(
    'https://ttsave.net/wp-admin/admin-ajax.php',
    new URLSearchParams({ action: 'tktdl_start_mp4_job', nonce: nextNonce, token, tiktok_url: url.href }).toString(),
    { headers: ajaxHeaders, httpsAgent: agent, signal: timeout(signal, 15000), validateStatus: () => true }
  )

  if (!job.data?.success || !job.data?.data?.job_id) throw new Error('TTSave: MP4 job unavailable')

  const jobId = job.data.data.job_id
  let video = null

  for (let i = 0; i < 8; i++) {
    await sleep(1500, signal)

    const status = await axios.post(
      'https://ttsave.net/wp-admin/admin-ajax.php',
      new URLSearchParams({ action: 'tktdl_mp4_job_status', nonce: nextNonce, job_id: jobId }).toString(),
      { headers: ajaxHeaders, httpsAgent: agent, signal: timeout(signal, 10000), validateStatus: () => true }
    )

    if (status.data?.success && status.data?.data?.status === 'ready' && status.data.data.download_url) {
      video = status.data.data.download_url
      break
    }
  }

  video ??= `https://ttsave.net/wp-admin/admin-ajax.php?action=tktdl_download_mp4_job&job_id=${jobId}&nonce=${nextNonce}`

  const id = url.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? null

  return {
    id,
    tipo: 'video',
    titulo: title,
    portada: thumbnail,
    autor: { usuario: author, nombre: author, avatar },
    estadisticas: { vistas: 0, likes: 0, comentarios: 0, compartidos: 0, favoritos: 0 },
    musica: { titulo: 'Audio Original', autor: author, url: audio },
    datos: { tipo: 'video', archivo: `${id ?? 'tiktok'}.mp4`, extension: '.mp4', calidad: 'HD', url: video }
  }
}

export { download }
export default { download }