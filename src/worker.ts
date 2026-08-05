const LEGACY_HOSTNAME = 'amtrak-bike-map.transittools.dev'
const CANONICAL_HOSTNAME = 'bikesonamtrak.com'

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const url = new URL(request.url)

    if (url.hostname === LEGACY_HOSTNAME) {
      url.protocol = 'https:'
      url.hostname = CANONICAL_HOSTNAME
      url.port = ''
      return Response.redirect(url.toString(), 308)
    }

    return env.ASSETS.fetch(request)
  },
}
