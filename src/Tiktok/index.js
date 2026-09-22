import v1 from './v1.js'
import v2 from './v2.js'
import v3 from './v3.js'

const providers = [v1, v2, v3]

async function download(input, options = {}) {
  const controllers = providers.map(() => new AbortController())
  const signal = options.signal

  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')

  const abortAll = () => controllers.forEach(x => x.abort(signal?.reason))
  signal?.addEventListener('abort', abortAll, { once: true })

  const run = async (provider, index) => {
    const result = await provider.download(input, { ...options, signal: controllers[index].signal })
    if (!valid(result)) throw new Error(`v${index + 1} returned an invalid response`)
    return { ...result, provider: `v${index + 1}`, _winner: index }
  }

  try {
    const result = await Promise.any(providers.map(run))
    controllers.forEach((controller, index) => index !== result._winner && controller.abort())
    const { _winner, ...clean } = result
    return clean
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error

    if (error instanceof AggregateError) {
      throw new Error(`All TikTok providers failed: ${error.errors.map(x => x?.message ?? String(x)).join(' | ')}`)
    }

    throw error
  } finally {
    signal?.removeEventListener('abort', abortAll)
  }
}

function valid(result) {
  if (!result || typeof result !== 'object' || typeof result?.datos?.url !== 'string') return false
  try {
    return ['http:', 'https:'].includes(new URL(result.datos.url).protocol)
  } catch {
    return false
  }
}

export { download, v1, v2, v3 }
export default { download, v1, v2, v3 }