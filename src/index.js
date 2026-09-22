import v1 from './v1.js'
import v2 from './v2.js'

async function download(input, options = {}) {
  const controllers = [new AbortController(), new AbortController()]
  const signal = options.signal

  if (signal?.aborted) throw signal.reason
  const abort = () => controllers.forEach(c => c.abort(signal?.reason))
  signal?.addEventListener('abort', abort, { once: true })

  const run = async (provider, controller, index) => {
    const result = await provider.download(input, { ...options, signal: controller.signal })
    if (!validDownload(result)) throw new Error(`v${index + 1} returned an invalid response`)
    return { ...result, provider: `v${index + 1}`, _winner: index }
  }

  try {
    const result = await Promise.any([
      run(v1, controllers[0], 0),
      run(v2, controllers[1], 1)
    ])
    controllers.forEach((c, i) => {
      if (i !== result._winner) c.abort()
    })
    const { _winner, ...clean } = result
    return clean
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    if (error instanceof AggregateError) {
      throw new Error(`All providers failed: ${error.errors.map(e => e?.message ?? e).join(' | ')}`)
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

async function getVideo(input, options = {}) {
  const controllers = [new AbortController(), new AbortController()]
  const signal = options.signal
  if (signal?.aborted) throw signal.reason
  const abort = () => controllers.forEach(c => c.abort(signal?.reason))
  signal?.addEventListener('abort', abort, { once: true })

  const run = async (provider, controller, index) => {
    const result = await provider.getVideo(input, { ...options, signal: controller.signal })
    if (!result?.id || !result?.title) throw new Error(`v${index + 1} returned invalid video info`)
    return { ...result, provider: `v${index + 1}`, _winner: index }
  }

  try {
    const result = await Promise.any([
      run(v1, controllers[0], 0),
      run(v2, controllers[1], 1)
    ])
    controllers.forEach((c, i) => {
      if (i !== result._winner) c.abort()
    })
    const { _winner, ...clean } = result
    return clean
  } catch (error) {
    if (error instanceof AggregateError) {
      throw new Error(`All providers failed: ${error.errors.map(e => e?.message ?? e).join(' | ')}`)
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

function validDownload(data) {
  if (!data || typeof data !== 'object') return false
  if (typeof data.url !== 'string') return false
  try {
    const url = new URL(data.url)
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

export { download, getVideo, v1, v2 }
export default { download, getVideo, v1, v2 }