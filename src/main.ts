import { createTrailheadMap, lonLatView, validateConfig } from 'olmap'
import type { MapFeatureDetails, TrailheadMapEvent } from 'olmap'
import 'olmap/styles/openlayers.css'
import 'olmap/styles/default.css'
import './styles.css'

const mapElement = document.querySelector<HTMLElement>('#map')!
const statusElement = document.querySelector<HTMLElement>('#status')!
const routeCard = document.querySelector<HTMLElement>('#route-card')!
const cardLabel = document.querySelector<HTMLElement>('#card-label')!
const routeName = document.querySelector<HTMLElement>('#route-name')!
const routeList = document.querySelector<HTMLUListElement>('#route-list')!
const closeCard = document.querySelector<HTMLButtonElement>('#close-card')!
const mapShell = document.querySelector<HTMLElement>('.map-shell')!
const listView = document.querySelector<HTMLElement>('#list-view')!
const faqView = document.querySelector<HTMLElement>('#faq-view')!
const allRoutes = document.querySelector<HTMLElement>('#all-routes')!
const mapViewButton = document.querySelector<HTMLButtonElement>('#map-view-button')!
const listViewButton = document.querySelector<HTMLButtonElement>('#list-view-button')!
const faqViewButton = document.querySelector<HTMLButtonElement>('#faq-view-button')!
const homeLink = document.querySelector<HTMLAnchorElement>('#home-link')!

type RouteInfo = Pick<MapFeatureDetails, 'name' | 'properties'>
type BikeStation = { code: string; name: string; status: string; has_access: boolean }
type StationRoute = { route_id: string; name: string; status: string; has_access: boolean }

let routeInfoPromise: Promise<RouteInfo[]> | undefined
let stopRenderVersion = 0

function loadRouteInfo(): Promise<RouteInfo[]> {
  routeInfoPromise ??= fetch('/amtrak-route-summaries.json').then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json() as Array<Record<string, string | number | boolean | null>>
    return data.map((properties) => ({
      name: String(properties.route_long_name ?? 'Amtrak route'),
      properties,
    } satisfies RouteInfo)).sort((left, right) => left.name.localeCompare(right.name))
  })
  return routeInfoPromise
}

function bikeAccessLabel(status: string, hasAccess: boolean): string {
  if (status === 'yes') return 'Bike access'
  if (status === 'no') return 'No bike access'
  if (status === 'unavailable') return 'Bike access listed but booking not available'
  return hasAccess ? `Bike access (${status})` : `No bike access (${status})`
}

const config = validateConfig({
  schema_version: 'legacy-1',
  data_version: '2026-08-04',
  feeds: {
    amtrak: {
      gtfs: { url: '/amtrak-gtfs.zip' },
      agencies: {
        '51': { type: 'rail', long_name: 'Amtrak' },
      },
    },
  },
  feed_groups: {},
  kml_groups: { hardcoded: {}, generated: {} },
})

function routeContent(route: RouteInfo, includeTitle = true): DocumentFragment {
  const content = document.createDocumentFragment()
  const url = route.properties.route_url
  if (includeTitle) {
    const title = document.createElement(typeof url === 'string' && url ? 'a' : 'span')
    title.className = 'route-title'
    title.textContent = route.name
    if (title instanceof HTMLAnchorElement) {
      title.href = String(url)
      title.target = '_blank'
      title.rel = 'noreferrer'
    }
    content.append(title)
  }

  const access = Number(route.properties.bike_access_count)
  const noAccess = Number(route.properties.bike_no_access_count)
  const accessPercent = Number(route.properties.bike_access_percent)
  const noAccessPercent = Number(route.properties.bike_no_access_percent)
  const statistics = document.createElement('span')
  statistics.className = 'bike-statistics'
  statistics.textContent = Number.isFinite(access) && Number.isFinite(noAccess)
    ? `${access} (${accessPercent.toFixed(1)}%) with bike access · ${noAccess} (${noAccessPercent.toFixed(1)}%) without`
    : 'Bike access data unavailable'
  content.append(statistics)

  if (route.properties.remove_wheel === 'yes') {
    const wheelWarning = document.createElement('p')
    wheelWarning.className = 'wheel-warning'
    wheelWarning.textContent = '⚠ Must remove front wheel while storing bike'
    content.append(wheelWarning)
  }

  const serviceOptions = document.createElement('dl')
  serviceOptions.className = 'service-options'
  const addService = (label: string, available: boolean): void => {
    const term = document.createElement('dt')
    term.textContent = label
    const value = document.createElement('dd')
    value.className = available ? 'available' : 'unavailable'
    value.textContent = available ? 'Available' : 'Not available'
    serviceOptions.append(term, value)
  }
  const carryOnAvailable = route.properties.carry_on === 'yes'
  const checkedAvailable = route.properties.checked === 'yes'
  addService('Carry-on bicycle service', carryOnAvailable)
  addService('Checked bicycle service', checkedAvailable)

  if (carryOnAvailable || checkedAvailable) {
    const reservationRequired = route.properties.reservation_required !== 'no'
    const reservationTerm = document.createElement('dt')
    reservationTerm.textContent = 'Reservation'
    const reservationValue = document.createElement('dd')
    reservationValue.className = reservationRequired ? 'warning' : 'success'
    reservationValue.textContent = reservationRequired ? '⚠ Reservation required' : '✓ No reservation required'

    const tireWidth = typeof route.properties.tire_width === 'string' && route.properties.tire_width.trim()
      ? route.properties.tire_width.trim()
      : '2'
    const tireTerm = document.createElement('dt')
    tireTerm.textContent = 'Tire width'
    const tireValue = document.createElement('dd')
    tireValue.textContent = `Up to ${tireWidth}\"`
    serviceOptions.append(reservationTerm, reservationValue, tireTerm, tireValue)
  }
  content.append(serviceOptions)

  const note = route.properties.service_note
  if (typeof note === 'string' && note.trim()) {
    const noteElement = document.createElement('p')
    noteElement.className = 'service-note'
    noteElement.textContent = note
    content.append(noteElement)
  }

  const encodedStations = route.properties.bike_stations
  if (typeof encodedStations === 'string') {
    const stations = JSON.parse(encodedStations) as BikeStation[]
    const details = document.createElement('details')
    details.className = 'stop-details'
    const summary = document.createElement('summary')
    summary.textContent = `Stop information (${stations.length})`
    const list = document.createElement('ul')
    list.className = 'stop-info-list'
    list.append(...stations.map((station) => {
      const item = document.createElement('li')
      item.className = station.has_access ? 'has-access' : 'no-access'
      const name = document.createElement('span')
      name.textContent = `${station.name} (${station.code})`
      const status = document.createElement('span')
      status.textContent = bikeAccessLabel(station.status, station.has_access)
      item.append(name, status)
      return item
    }))
    details.append(summary, list)
    content.append(details)
  }
  return content
}

function showRoutes(features: MapFeatureDetails[]): void {
  stopRenderVersion += 1
  const routes = [...new Map(features.map((feature) => [String(feature.properties.route_id), feature])).values()]
    .sort((left, right) => left.name.localeCompare(right.name))
  cardLabel.textContent = routes.length === 1 ? 'Amtrak route' : `${routes.length} Amtrak routes`
  routeName.textContent = routes.length === 1 ? '' : 'Routes at this location'
  if (routes.length === 1) {
    const route = routes[0]
    const url = route.properties.route_url
    const heading = document.createElement(typeof url === 'string' && url ? 'a' : 'span')
    heading.textContent = route.name
    if (heading instanceof HTMLAnchorElement) {
      heading.href = String(url)
      heading.target = '_blank'
      heading.rel = 'noreferrer'
    }
    routeName.append(heading)
  }
  routeList.replaceChildren(...routes.map((route) => {
    const item = document.createElement('li')
    item.className = 'route-result'
    item.append(routeContent(route, routes.length !== 1))
    return item
  }))
  routeCard.hidden = false
}

async function populateRouteList(): Promise<void> {
  const routes = await loadRouteInfo()
  allRoutes.replaceChildren(...routes.map((route) => {
    const article = document.createElement('article')
    article.className = 'route-card list-route-card'
    article.append(routeContent(route))
    return article
  }))
}

async function showStop(feature: MapFeatureDetails): Promise<void> {
  const renderVersion = ++stopRenderVersion
  cardLabel.textContent = 'Amtrak station'
  routeName.textContent = feature.name
  routeList.textContent = 'Loading service details…'
  routeCard.hidden = false
  const encodedRoutes = feature.properties.bike_routes
  if (typeof encodedRoutes === 'string') {
    const routes = (JSON.parse(encodedRoutes) as StationRoute[]).sort((left, right) =>
      Number(right.has_access) - Number(left.has_access) || left.name.localeCompare(right.name),
    )
    const routeInfo = await loadRouteInfo().catch(() => [])
    if (renderVersion !== stopRenderVersion) return
    const routeInfoById = new Map(routeInfo.map((route) => [String(route.properties.route_id), route]))
    routeList.replaceChildren(...routes.map((route) => {
      const item = document.createElement('li')
      item.className = `station-route ${route.has_access ? 'has-access' : 'no-access'}`
      const name = document.createElement('span')
      name.textContent = route.name
      const status = document.createElement('span')
      status.className = 'access-status'
      status.textContent = bikeAccessLabel(route.status, route.has_access)
      const detailsRoute = routeInfoById.get(String(route.route_id))
      if (route.has_access && detailsRoute) {
        const details = document.createElement('details')
        details.className = 'station-route-details'
        const summary = document.createElement('summary')
        summary.append(name, status)
        const content = document.createElement('div')
        content.className = 'station-route-content'
        content.append(routeContent(detailsRoute, false))
        details.append(summary, content)
        item.append(details)
      } else {
        item.append(name, status)
      }
      return item
    }))
  }
}

function handleEvent(event: TrailheadMapEvent): void {
  if (event.type === 'layer-progress') {
    if (event.layer.status === 'ready') statusElement.textContent = '47 routes · 532 stations · updated August 4, 2026'
    if (event.layer.status === 'error') statusElement.textContent = 'Route data could not be loaded'
  }
  if (event.type === 'feature-select' && event.feature.kind === 'transit-route') showRoutes([event.feature])
  if (event.type === 'feature-select' && event.feature.kind === 'transit-stop') void showStop(event.feature)
  if (event.type === 'features-select') {
    const stop = event.features.find((feature) => feature.kind === 'transit-stop')
    if (stop) {
      void showStop(stop)
      return
    }
    const routes = event.features.filter((feature) => feature.kind === 'transit-route')
    if (routes.length) showRoutes(routes)
  }
  if (event.type === 'selection-clear') {
    stopRenderVersion += 1
    routeCard.hidden = true
  }
}

const controller = createTrailheadMap({
  target: mapElement,
  config,
  dataSources: [{
    id: 'amtrak',
    kind: 'geojson',
    role: 'transit',
    url: '/amtrak-routes.geojson',
    attribution: 'Amtrak and Gold Runner GTFS',
    sourceUrl: '/amtrak-gtfs.zip',
    version: '2026-08-04',
    cachePolicy: 'memory',
    visible: true,
  }, {
    id: 'amtrak-stops',
    kind: 'geojson',
    role: 'transit',
    url: '/amtrak-stops.geojson',
    attribution: 'Amtrak and Gold Runner GTFS with bike reservation data',
    sourceUrl: '/amtrak-gtfs.zip',
    version: '2026-08-04',
    cachePolicy: 'memory',
    visible: true,
    pointMarkers: true,
  }],
  tileSource: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  initialView: lonLatView(-98.5, 39.5, 4),
  cooperativeGestures: false,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  onEvent: handleEvent,
})

mapElement.querySelector('.olmap-location-control')?.remove()

closeCard.addEventListener('click', () => controller.clearSelection())
type View = 'map' | 'list' | 'faq'

function setView(view: View, updateHistory = true): void {
  const showMap = view === 'map'
  const showList = view === 'list'
  const showFaq = view === 'faq'
  mapShell.hidden = !showMap
  listView.hidden = !showList
  faqView.hidden = !showFaq
  mapViewButton.setAttribute('aria-pressed', String(showMap))
  listViewButton.setAttribute('aria-pressed', String(showList))
  faqViewButton.setAttribute('aria-pressed', String(showFaq))
  document.body.classList.toggle('map-view-active', showMap)
  document.title = showFaq ? 'FAQ · Amtrak Bicycle Access' : 'Amtrak Bicycle Access'
  if (updateHistory) history.pushState({ view }, '', showFaq ? '#faq' : showList ? '#list' : window.location.pathname)
  if (showMap) requestAnimationFrame(() => controller.updateSize())
}

mapViewButton.addEventListener('click', () => setView('map'))
listViewButton.addEventListener('click', () => setView('list'))
faqViewButton.addEventListener('click', () => setView('faq'))
homeLink.addEventListener('click', (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  setView('map')
})
function viewFromLocation(): View {
  if (window.location.hash === '#faq') return 'faq'
  if (window.location.hash === '#list') return 'list'
  return 'map'
}

window.addEventListener('popstate', () => setView(viewFromLocation(), false))
setView(viewFromLocation(), false)
void populateRouteList().catch(() => {
  allRoutes.textContent = 'Route list could not be loaded.'
})
window.addEventListener('beforeunload', () => controller.destroy(), { once: true })
