import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  CssBaseline,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme,
  Autocomplete,
  TextField,
  Alert,
  CircularProgress,
} from '@mui/material'
import {
  AccessTime,
  ArrowForward,
  DirectionsWalk,
  DirectionsBus,
  MyLocation,
  Place,
} from '@mui/icons-material'
import stopsRaw from '../MJ_transit_GTFS/stops.txt?raw'
import stopTimesRaw from '../MJ_transit_GTFS/stop_times.txt?raw'
import routesRaw from '../MJ_transit_GTFS/routes.txt?raw'
import tripsRaw from '../MJ_transit_GTFS/trips.txt?raw'

type Stop = {
  stop_id: string
  stop_code: string
  stop_name: string
  stop_lat: number
  stop_lon: number
}

type StopTime = {
  trip_id: string
  arrival_time: string
  departure_time: string
  stop_id: string
  stop_sequence: number
}

type Trip = {
  trip_id: string
  route_id: string
  trip_headsign: string
  trip_short_name: string
}

type Route = {
  route_id: string
  route_short_name: string
  route_long_name: string
}

type CandidateTrip = {
  trip: Trip
  route: Route | undefined
  boardStop: Stop
  alightStop: Stop
  boardTime: string
  alightTime: string
  boardSequence: number
  alightSequence: number
}

type TransferPlan = {
  firstLeg: CandidateTrip
  secondLeg: CandidateTrip
  transferStop: Stop
  layoverMinutes: number
  totalMinutes: number
}

type AddressSuggestion = {
  description: string
  place_id: string
  source: 'nominatim' | 'geocoder'
  location?: { lat: number; lng: number }
}

type AddressResult = {
  address: string
  location: { lat: number; lng: number }
}

type NominatimAddress = {
  house_number?: string
  road?: string
  pedestrian?: string
  footway?: string
  cycleway?: string
  highway?: string
  neighbourhood?: string
  suburb?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
  hamlet?: string
  state?: string
  province?: string
  region?: string
  postcode?: string
}

type NominatimResult = {
  place_id: number
  display_name: string
  lat: string
  lon: string
  class?: string
  type?: string
  address?: NominatimAddress
}

type NominatimReverseResult = {
  place_id: number
  display_name: string
  address?: NominatimAddress
}

type Bounds = {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

type GeocoderResult = {
  latt?: string
  longt?: string
  standard?: {
    staddress?: string
    stnumber?: string
    city?: string
    prov?: string
  }
}

const nominatimBaseUrl = 'https://nominatim.openstreetmap.org/search'
const nominatimLookupUrl = 'https://nominatim.openstreetmap.org/lookup'
const nominatimReverseUrl = 'https://nominatim.openstreetmap.org/reverse'
const geocoderBaseUrl = 'https://geocoder.ca/'
const mooseJawName = 'moose jaw'
const mooseJawProvince = 'saskatchewan'
const mooseJawProvinceAbbr = 'sk'
const serviceAreaPadding = 0.05

const parseCsv = (raw: string) => {
  const [headerLine, ...lines] = raw.trim().split(/\r?\n/)
  const headers = headerLine.split(',')
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split(',')
      return headers.reduce<Record<string, string>>((acc, header, index) => {
        acc[header] = values[index] ?? ''
        return acc
      }, {})
    })
}

const timeToMinutes = (value: string) => {
  const [hours, minutes, seconds] = value.split(':').map((part) => Number(part) || 0)
  return hours * 60 + minutes + seconds / 60
}

const gtfsTimeZone = 'America/Regina'

const getNowMinutes = () => {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: gtfsTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const hours = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minutes = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hours * 60 + minutes
}

const formatTime = (value: string) => {
  const [rawHours, rawMinutes] = value.split(':')
  const hoursTotal = Number(rawHours)
  const minutes = Number(rawMinutes)
  if (!Number.isFinite(hoursTotal) || !Number.isFinite(minutes)) {
    return value
  }
  const hours24 = ((hoursTotal % 24) + 24) % 24
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12
  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`
}
const minutesBetween = (start: string, end: string) => timeToMinutes(end) - timeToMinutes(start)

const buildNominatimLabel = (result: NominatimResult) => {
  const address = result.address
  if (!address) return result.display_name
  const road =
    address.road ??
    address.pedestrian ??
    address.footway ??
    address.cycleway ??
    address.highway
  const houseNumber = address.house_number?.trim()
  const primary = houseNumber && road ? `${houseNumber} ${road}` : road ?? result.display_name
  const locality =
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.hamlet
  const region = address.state ?? address.province ?? address.region
  const parts = [primary]
  if (address.neighbourhood) {
    parts.push(address.neighbourhood)
  } else if (address.suburb) {
    parts.push(address.suburb)
  }
  if (locality) parts.push(locality)
  if (region) parts.push(region)
  if (address.postcode) parts.push(address.postcode)
  return parts.join(', ')
}

const scoreNominatimResult = (result: NominatimResult) => {
  const hasHouseNumber = Boolean(result.address?.house_number?.trim())
  const isHouseType = result.type === 'house' || result.type === 'building'
  return (hasHouseNumber ? 2 : 0) + (isHouseType ? 1 : 0)
}

const normalize = (value?: string) => value?.trim().toLowerCase() ?? ''

const getNominatimLocality = (address?: NominatimAddress) =>
  address?.city ??
  address?.town ??
  address?.village ??
  address?.municipality ??
  address?.hamlet

const isMooseJawLocality = (value?: string) => normalize(value) === mooseJawName

const isMooseJawProvince = (value?: string) => {
  const normalized = normalize(value)
  return normalized === mooseJawProvince || normalized === mooseJawProvinceAbbr
}

const isMooseJawNominatimResult = (result: NominatimResult) => {
  const locality = getNominatimLocality(result.address)
  if (isMooseJawLocality(locality)) return true
  if (result.address?.state && !isMooseJawProvince(result.address.state)) return false
  return normalize(result.display_name).includes(mooseJawName)
}

const isMooseJawGeocoderResult = (result: GeocoderResult) => {
  const city = normalize(result.standard?.city)
  if (!city) return false
  if (city !== mooseJawName) return false
  const province = normalize(result.standard?.prov)
  if (!province) return true
  return province === mooseJawProvince || province === mooseJawProvinceAbbr
}

const isWithinBounds = (lat: number, lon: number, bounds: Bounds | null) => {
  if (!bounds) return true
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lon >= bounds.minLon &&
    lon <= bounds.maxLon
  )
}

const setNominatimSearchParams = (
  url: URL,
  query: string,
  isHouseNumberQuery: boolean,
  limit: number,
  preferAddressOnly: boolean,
  bounds: Bounds | null
) => {
  url.searchParams.set('format', 'json')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('q', query)
  url.searchParams.set('countrycodes', 'ca')
  url.searchParams.set('accept-language', 'en')
  url.searchParams.set('dedupe', '0')
  if (bounds) {
    url.searchParams.set(
      'viewbox',
      `${bounds.minLon},${bounds.maxLat},${bounds.maxLon},${bounds.minLat}`
    )
    url.searchParams.set('bounded', '1')
  }
  if (isHouseNumberQuery && preferAddressOnly) {
    url.searchParams.set('featuretype', 'address')
  }
}

const haversineDistanceKm = (a: Stop, lat: number, lon: number) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(lat - a.stop_lat)
  const dLon = toRad(lon - a.stop_lon)
  const originLat = toRad(a.stop_lat)
  const destLat = toRad(lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destLat) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h))
}

const findNearestStop = (stops: Stop[], lat: number, lon: number) => {
  let nearest = stops[0]
  let nearestDistance = haversineDistanceKm(nearest, lat, lon)
  for (const stop of stops) {
    const distance = haversineDistanceKm(stop, lat, lon)
    if (distance < nearestDistance) {
      nearest = stop
      nearestDistance = distance
    }
  }
  return { stop: nearest, distanceKm: nearestDistance }
}

const pickNearestStop = (primary: Stop[], fallback: Stop[], lat: number, lon: number) => {
  if (primary.length > 0) return findNearestStop(primary, lat, lon)
  if (fallback.length > 0) return findNearestStop(fallback, lat, lon)
  return null
}

const buildEligibleStopIds = (
  destination: Stop,
  trips: Trip[],
  stopTimesByTrip: Map<string, StopTime[]>
) => {
  const directReachable = new Set<string>()
  trips.forEach((trip) => {
    const stopTimes = stopTimesByTrip.get(trip.trip_id)
    if (!stopTimes) return
    const destIndex = stopTimes.findIndex((time) => time.stop_id === destination.stop_id)
    if (destIndex <= 0) return
    for (let i = 0; i < destIndex; i += 1) {
      directReachable.add(stopTimes[i].stop_id)
    }
  })

  const transferReachable = new Set<string>()
  if (directReachable.size > 0) {
    trips.forEach((trip) => {
      const stopTimes = stopTimesByTrip.get(trip.trip_id)
      if (!stopTimes) return
      for (let i = 0; i < stopTimes.length; i += 1) {
        const stopId = stopTimes[i].stop_id
        if (!directReachable.has(stopId)) continue
        for (let j = 0; j < i; j += 1) {
          transferReachable.add(stopTimes[j].stop_id)
        }
      }
    })
  }

  return new Set([...directReachable, ...transferReachable])
}

const theme = createTheme({
  typography: {
    fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
  },
  palette: {
    primary: {
      main: '#1f4e5f',
    },
    secondary: {
      main: '#f39c6b',
    },
    background: {
      default: '#f6f3ef',
    },
  },
})

function App() {
  const [origin, setOrigin] = useState<Stop | null>(null)
  const [destination, setDestination] = useState<Stop | null>(null)
  const [geolocating, setGeolocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [addressInput, setAddressInput] = useState('')
  const [addressSelection, setAddressSelection] = useState<AddressSuggestion | null>(null)
  const [addressOptions, setAddressOptions] = useState<AddressSuggestion[]>([])
  const [addressLoading, setAddressLoading] = useState(false)
  const [addressResult, setAddressResult] = useState<AddressResult | null>(null)
  const [addressError, setAddressError] = useState<string | null>(null)
  const [addressClosestStop, setAddressClosestStop] = useState<{
    stop: Stop
    distanceKm: number
  } | null>(null)
  const [destinationInput, setDestinationInput] = useState('')
  const [destinationSelection, setDestinationSelection] = useState<AddressSuggestion | null>(null)
  const [destinationOptions, setDestinationOptions] = useState<AddressSuggestion[]>([])
  const [destinationLoading, setDestinationLoading] = useState(false)
  const [destinationResult, setDestinationResult] = useState<AddressResult | null>(null)
  const [destinationError, setDestinationError] = useState<string | null>(null)
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes)
  const addressTimeout = useRef<number | null>(null)
  const addressAbort = useRef<AbortController | null>(null)
  const destinationTimeout = useRef<number | null>(null)
  const destinationAbort = useRef<AbortController | null>(null)

  const stops = useMemo<Stop[]>(() => {
    return parseCsv(stopsRaw).map((row) => ({
      stop_id: row.stop_id,
      stop_code: row.stop_code,
      stop_name: row.stop_name,
      stop_lat: Number(row.stop_lat),
      stop_lon: Number(row.stop_lon),
    }))
  }, [])

  const serviceBounds = useMemo<Bounds | null>(() => {
    if (stops.length === 0) return null
    let minLat = Infinity
    let maxLat = -Infinity
    let minLon = Infinity
    let maxLon = -Infinity
    stops.forEach((stop) => {
      if (stop.stop_lat < minLat) minLat = stop.stop_lat
      if (stop.stop_lat > maxLat) maxLat = stop.stop_lat
      if (stop.stop_lon < minLon) minLon = stop.stop_lon
      if (stop.stop_lon > maxLon) maxLon = stop.stop_lon
    })
    return {
      minLat: minLat - serviceAreaPadding,
      maxLat: maxLat + serviceAreaPadding,
      minLon: minLon - serviceAreaPadding,
      maxLon: maxLon + serviceAreaPadding,
    }
  }, [stops])

  const routes = useMemo<Route[]>(() => {
    return parseCsv(routesRaw).map((row) => ({
      route_id: row.route_id,
      route_short_name: row.route_short_name,
      route_long_name: row.route_long_name,
    }))
  }, [])

  const trips = useMemo<Trip[]>(() => {
    return parseCsv(tripsRaw).map((row) => ({
      trip_id: row.trip_id,
      route_id: row.route_id,
      trip_headsign: row.trip_headsign,
      trip_short_name: row.trip_short_name,
    }))
  }, [])

  const stopTimesByTrip = useMemo(() => {
    const stopTimes = parseCsv(stopTimesRaw).map((row) => ({
      trip_id: row.trip_id,
      arrival_time: row.arrival_time,
      departure_time: row.departure_time,
      stop_id: row.stop_id,
      stop_sequence: Number(row.stop_sequence),
    }))
    const grouped = new Map<string, StopTime[]>()
    stopTimes.forEach((stopTime) => {
      const list = grouped.get(stopTime.trip_id) ?? []
      list.push(stopTime)
      grouped.set(stopTime.trip_id, list)
    })
    grouped.forEach((list) => list.sort((a, b) => a.stop_sequence - b.stop_sequence))
    return grouped
  }, [])

  const stopById = useMemo(() => {
    return new Map(stops.map((stop) => [stop.stop_id, stop]))
  }, [stops])

  const routeById = useMemo(() => {
    return new Map(routes.map((route) => [route.route_id, route]))
  }, [routes])

  const eligibleStopsForDestination = useMemo(() => {
    if (!destination) return stops
    const eligibleStopIds = buildEligibleStopIds(destination, trips, stopTimesByTrip)
    if (eligibleStopIds.size === 0) return []
    return stops.filter((stop) => eligibleStopIds.has(stop.stop_id))
  }, [destination, stops, stopTimesByTrip, trips])

  const lookupAddressSuggestions = async (query: string) => {
    if (!query.trim()) {
      setAddressOptions([])
      setAddressLoading(false)
      return
    }
    if (stops.length === 0) {
      setAddressOptions([])
      setAddressLoading(false)
      return
    }

    if (addressAbort.current) {
      addressAbort.current.abort()
    }
    const controller = new AbortController()
    addressAbort.current = controller

    const trimmedQuery = query.trim()
    const isHouseNumberQuery = /^\d{1,6}\s+/.test(trimmedQuery)
    const fetchNominatim = async () => {
      const fetchWithPreference = async (preferAddressOnly: boolean) => {
        const url = new URL(nominatimBaseUrl)
        setNominatimSearchParams(
          url,
          trimmedQuery,
          isHouseNumberQuery,
          10,
          preferAddressOnly,
          serviceBounds
        )
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) {
          throw new Error('Address lookup failed.')
        }
        return (await response.json()) as NominatimResult[]
      }

      let combinedResults: NominatimResult[] = await fetchWithPreference(true)
      if (isHouseNumberQuery) {
        const broaderResults = await fetchWithPreference(false)
        const byId = new Map<string, NominatimResult>()
        combinedResults.forEach((result) => byId.set(String(result.place_id), result))
        broaderResults.forEach((result) => byId.set(String(result.place_id), result))
        combinedResults = Array.from(byId.values())
      }
      const orderedResults = isHouseNumberQuery
        ? [...combinedResults].sort((a, b) => scoreNominatimResult(b) - scoreNominatimResult(a))
        : combinedResults
      const filteredResults = orderedResults.filter((result) => {
        const lat = Number(result.lat)
        const lon = Number(result.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
        return isMooseJawNominatimResult(result) && isWithinBounds(lat, lon, serviceBounds)
      })
      return filteredResults.map((result) => ({
        description: buildNominatimLabel(result),
        place_id: String(result.place_id),
        source: 'nominatim' as const,
      }))
    }
    const fetchGeocoder = async () => {
      if (!isHouseNumberQuery) return null
      const url = new URL(geocoderBaseUrl)
      url.searchParams.set('locate', trimmedQuery)
      url.searchParams.set('json', '1')
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        return null
      }
      const result = (await response.json()) as GeocoderResult
      const lat = Number(result.latt)
      const lng = Number(result.longt)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null
      }
      if (!isMooseJawGeocoderResult(result) || !isWithinBounds(lat, lng, serviceBounds)) {
        return null
      }
      const standard = result.standard
      const stnumber = standard?.stnumber?.trim()
      const staddress = standard?.staddress?.trim()
      const city = standard?.city?.trim()
      const prov = standard?.prov?.trim()
      if (!stnumber || !staddress || !city || !prov) {
        return null
      }
      const description = `${stnumber} ${staddress}, ${city}, ${prov}`
      return {
        description,
        place_id: `geocoder:${stnumber}-${staddress}-${city}-${prov}`,
        source: 'geocoder' as const,
        location: { lat, lng },
      }
    }

    try {
      const [nominatimResult, geocoderResult] = await Promise.allSettled([
        fetchNominatim(),
        fetchGeocoder(),
      ])
      const options: AddressSuggestion[] = []
      if (geocoderResult.status === 'fulfilled' && geocoderResult.value) {
        options.push(geocoderResult.value)
      }
      if (nominatimResult.status === 'fulfilled') {
        nominatimResult.value.forEach((option) => {
          if (!options.some((existing) => existing.description === option.description)) {
            options.push(option)
          }
        })
      }
      setAddressOptions(options)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setAddressOptions([])
      }
    } finally {
      setAddressLoading(false)
    }
  }

  const lookupDestinationSuggestions = async (query: string) => {
    if (!query.trim()) {
      setDestinationOptions([])
      setDestinationLoading(false)
      return
    }
    if (stops.length === 0) {
      setDestinationOptions([])
      setDestinationLoading(false)
      return
    }

    if (destinationAbort.current) {
      destinationAbort.current.abort()
    }
    const controller = new AbortController()
    destinationAbort.current = controller

    const trimmedQuery = query.trim()
    const isHouseNumberQuery = /^\d{1,6}\s+/.test(trimmedQuery)
    const fetchNominatim = async () => {
      const fetchWithPreference = async (preferAddressOnly: boolean) => {
        const url = new URL(nominatimBaseUrl)
        setNominatimSearchParams(
          url,
          trimmedQuery,
          isHouseNumberQuery,
          10,
          preferAddressOnly,
          serviceBounds
        )
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) {
          throw new Error('Address lookup failed.')
        }
        return (await response.json()) as NominatimResult[]
      }

      let combinedResults: NominatimResult[] = await fetchWithPreference(true)
      if (isHouseNumberQuery) {
        const broaderResults = await fetchWithPreference(false)
        const byId = new Map<string, NominatimResult>()
        combinedResults.forEach((result) => byId.set(String(result.place_id), result))
        broaderResults.forEach((result) => byId.set(String(result.place_id), result))
        combinedResults = Array.from(byId.values())
      }
      const orderedResults = isHouseNumberQuery
        ? [...combinedResults].sort((a, b) => scoreNominatimResult(b) - scoreNominatimResult(a))
        : combinedResults
      const filteredResults = orderedResults.filter((result) => {
        const lat = Number(result.lat)
        const lon = Number(result.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
        return isMooseJawNominatimResult(result) && isWithinBounds(lat, lon, serviceBounds)
      })
      return filteredResults.map((result) => ({
        description: buildNominatimLabel(result),
        place_id: String(result.place_id),
        source: 'nominatim' as const,
      }))
    }
    const fetchGeocoder = async () => {
      if (!isHouseNumberQuery) return null
      const url = new URL(geocoderBaseUrl)
      url.searchParams.set('locate', trimmedQuery)
      url.searchParams.set('json', '1')
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        return null
      }
      const result = (await response.json()) as GeocoderResult
      const lat = Number(result.latt)
      const lng = Number(result.longt)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null
      }
      if (!isMooseJawGeocoderResult(result) || !isWithinBounds(lat, lng, serviceBounds)) {
        return null
      }
      const standard = result.standard
      const stnumber = standard?.stnumber?.trim()
      const staddress = standard?.staddress?.trim()
      const city = standard?.city?.trim()
      const prov = standard?.prov?.trim()
      if (!stnumber || !staddress || !city || !prov) {
        return null
      }
      const description = `${stnumber} ${staddress}, ${city}, ${prov}`
      return {
        description,
        place_id: `geocoder:${stnumber}-${staddress}-${city}-${prov}`,
        source: 'geocoder' as const,
        location: { lat, lng },
      }
    }

    try {
      const [nominatimResult, geocoderResult] = await Promise.allSettled([
        fetchNominatim(),
        fetchGeocoder(),
      ])
      const options: AddressSuggestion[] = []
      if (geocoderResult.status === 'fulfilled' && geocoderResult.value) {
        options.push(geocoderResult.value)
      }
      if (nominatimResult.status === 'fulfilled') {
        nominatimResult.value.forEach((option) => {
          if (!options.some((existing) => existing.description === option.description)) {
            options.push(option)
          }
        })
      }
      setDestinationOptions(options)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setDestinationOptions([])
      }
    } finally {
      setDestinationLoading(false)
    }
  }

  const applyAddressLocation = (address: string, location: { lat: number; lng: number }) => {
    setAddressResult({ address, location })
    if (!destination) {
      setAddressClosestStop(null)
      setOrigin(null)
      return
    }
    const nearest = pickNearestStop(eligibleStopsForDestination, stops, location.lat, location.lng)
    if (!nearest) {
      setAddressClosestStop(null)
      setOrigin(null)
      return
    }
    setAddressClosestStop(nearest)
    setOrigin(nearest.stop)
  }

  const applyDestinationLocation = (address: string, location: { lat: number; lng: number }) => {
    if (stops.length === 0) {
      setDestinationResult({ address, location })
      setDestination(null)
      return
    }
    const nearest = findNearestStop(stops, location.lat, location.lng)
    setDestinationResult({ address, location })
    setDestination(nearest.stop)
  }

  const handleAddressSelect = async (_: unknown, value: AddressSuggestion | string | null) => {
    setAddressResult(null)
    setAddressClosestStop(null)
    setAddressError(null)
    if (!value) {
      setAddressSelection(null)
      setOrigin(null)
      return
    }
    if (typeof value === 'string') {
      const query = value.trim()
      if (!query) {
        setAddressSelection(null)
        setAddressLoading(false)
        return
      }
      setAddressLoading(true)
      try {
        const isHouseNumberQuery = /^\d{1,6}\s+/.test(query)
        if (isHouseNumberQuery) {
          const geocoderUrl = new URL(geocoderBaseUrl)
          geocoderUrl.searchParams.set('locate', query)
          geocoderUrl.searchParams.set('json', '1')
          const geocoderResponse = await fetch(geocoderUrl.toString(), {
            headers: { Accept: 'application/json' },
          })
          if (geocoderResponse.ok) {
            const result = (await geocoderResponse.json()) as GeocoderResult
            const lat = Number(result.latt)
            const lng = Number(result.longt)
            const standard = result.standard
            const stnumber = standard?.stnumber?.trim()
            const staddress = standard?.staddress?.trim()
            const city = standard?.city?.trim()
            const prov = standard?.prov?.trim()
            if (
              Number.isFinite(lat) &&
              Number.isFinite(lng) &&
              stnumber &&
              staddress &&
              city &&
              prov
            ) {
              if (
                !isMooseJawGeocoderResult(result) ||
                !isWithinBounds(lat, lng, serviceBounds)
              ) {
                setAddressError('Only Moose Jaw addresses are supported.')
                return
              }
              const description = `${stnumber} ${staddress}, ${city}, ${prov}`
              setAddressSelection({
                description,
                place_id: `geocoder:${stnumber}-${staddress}-${city}-${prov}`,
                source: 'geocoder',
                location: { lat, lng },
              })
              if (stops.length === 0) {
                return
              }
              applyAddressLocation(description, { lat, lng })
              return
            }
          }
        }

        const fetchWithPreference = async (preferAddressOnly: boolean) => {
          const url = new URL(nominatimBaseUrl)
          setNominatimSearchParams(
            url,
            query,
            isHouseNumberQuery,
            1,
            preferAddressOnly,
            serviceBounds
          )
          const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
          if (!response.ok) {
            throw new Error('Address lookup failed.')
          }
          return (await response.json()) as NominatimResult[]
        }
        let combinedResults: NominatimResult[] = await fetchWithPreference(true)
        if (isHouseNumberQuery) {
          const broaderResults = await fetchWithPreference(false)
          const byId = new Map<string, NominatimResult>()
          combinedResults.forEach((result) => byId.set(String(result.place_id), result))
          broaderResults.forEach((result) => byId.set(String(result.place_id), result))
          combinedResults = Array.from(byId.values())
        }
        const orderedResults = isHouseNumberQuery
          ? [...combinedResults].sort((a, b) => scoreNominatimResult(b) - scoreNominatimResult(a))
          : combinedResults
        const filteredResults = orderedResults.filter((result) => {
          const lat = Number(result.lat)
          const lon = Number(result.lon)
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
          return isMooseJawNominatimResult(result) && isWithinBounds(lat, lon, serviceBounds)
        })
        const top = filteredResults[0]
        if (!top) {
          setAddressError('Only Moose Jaw addresses are supported.')
          return
        }
        const label = buildNominatimLabel(top)
        setAddressSelection({
          description: label,
          place_id: String(top.place_id),
          source: 'nominatim',
        })
        if (stops.length === 0) {
          return
        }
        const location = { lat: Number(top.lat), lng: Number(top.lon) }
        applyAddressLocation(label, location)
      } finally {
        setAddressLoading(false)
      }
      return
    }
    if (value.source === 'geocoder' && value.location) {
      if (!isWithinBounds(value.location.lat, value.location.lng, serviceBounds)) {
        setAddressError('Only Moose Jaw addresses are supported.')
        setAddressLoading(false)
        return
      }
      setAddressSelection(value)
      if (stops.length === 0) {
        setAddressLoading(false)
        return
      }
      applyAddressLocation(value.description, value.location)
      setAddressLoading(false)
      return
    }
    setAddressSelection(value)

    if (stops.length === 0) {
      setAddressLoading(false)
      return
    }

    setAddressLoading(true)
    const url = new URL(nominatimLookupUrl)
    url.searchParams.set('format', 'json')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('place_ids', value.place_id)

    try {
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
      if (!response.ok) {
        throw new Error('Address lookup failed.')
      }
      const results = (await response.json()) as NominatimResult[]
      const top = results[0]
      if (!top) {
        setAddressError('Only Moose Jaw addresses are supported.')
        return
      }
      if (!isMooseJawNominatimResult(top)) {
        setAddressError('Only Moose Jaw addresses are supported.')
        return
      }
      const location = { lat: Number(top.lat), lng: Number(top.lon) }
      if (!isWithinBounds(location.lat, location.lng, serviceBounds)) {
        setAddressError('Only Moose Jaw addresses are supported.')
        return
      }
      applyAddressLocation(buildNominatimLabel(top), location)
    } finally {
      setAddressLoading(false)
    }
  }

  const handleDestinationSelect = async (
    _: unknown,
    value: AddressSuggestion | string | null
  ) => {
    setDestinationResult(null)
    setDestinationError(null)
    if (!value) {
      setDestinationSelection(null)
      setDestination(null)
      setOrigin(null)
      setAddressClosestStop(null)
      return
    }
    if (typeof value === 'string') {
      const query = value.trim()
      if (!query) {
        setDestinationSelection(null)
        setDestinationLoading(false)
        return
      }
      setDestinationLoading(true)
      try {
        const isHouseNumberQuery = /^\d{1,6}\s+/.test(query)
        if (isHouseNumberQuery) {
          const geocoderUrl = new URL(geocoderBaseUrl)
          geocoderUrl.searchParams.set('locate', query)
          geocoderUrl.searchParams.set('json', '1')
          const geocoderResponse = await fetch(geocoderUrl.toString(), {
            headers: { Accept: 'application/json' },
          })
          if (geocoderResponse.ok) {
            const result = (await geocoderResponse.json()) as GeocoderResult
            const lat = Number(result.latt)
            const lng = Number(result.longt)
            const standard = result.standard
            const stnumber = standard?.stnumber?.trim()
            const staddress = standard?.staddress?.trim()
            const city = standard?.city?.trim()
            const prov = standard?.prov?.trim()
            if (
              Number.isFinite(lat) &&
              Number.isFinite(lng) &&
              stnumber &&
              staddress &&
              city &&
              prov
            ) {
              if (
                !isMooseJawGeocoderResult(result) ||
                !isWithinBounds(lat, lng, serviceBounds)
              ) {
                setDestinationError('Only Moose Jaw addresses are supported.')
                return
              }
              const description = `${stnumber} ${staddress}, ${city}, ${prov}`
              setDestinationSelection({
                description,
                place_id: `geocoder:${stnumber}-${staddress}-${city}-${prov}`,
                source: 'geocoder',
                location: { lat, lng },
              })
              applyDestinationLocation(description, { lat, lng })
              return
            }
          }
        }

        const fetchWithPreference = async (preferAddressOnly: boolean) => {
          const url = new URL(nominatimBaseUrl)
          setNominatimSearchParams(
            url,
            query,
            isHouseNumberQuery,
            1,
            preferAddressOnly,
            serviceBounds
          )
          const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
          if (!response.ok) {
            throw new Error('Address lookup failed.')
          }
          return (await response.json()) as NominatimResult[]
        }
        let combinedResults: NominatimResult[] = await fetchWithPreference(true)
        if (isHouseNumberQuery) {
          const broaderResults = await fetchWithPreference(false)
          const byId = new Map<string, NominatimResult>()
          combinedResults.forEach((result) => byId.set(String(result.place_id), result))
          broaderResults.forEach((result) => byId.set(String(result.place_id), result))
          combinedResults = Array.from(byId.values())
        }
        const orderedResults = isHouseNumberQuery
          ? [...combinedResults].sort((a, b) => scoreNominatimResult(b) - scoreNominatimResult(a))
          : combinedResults
        const filteredResults = orderedResults.filter((result) => {
          const lat = Number(result.lat)
          const lon = Number(result.lon)
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
          return isMooseJawNominatimResult(result) && isWithinBounds(lat, lon, serviceBounds)
        })
        const top = filteredResults[0]
        if (!top) {
          setDestinationError('Only Moose Jaw addresses are supported.')
          return
        }
        const label = buildNominatimLabel(top)
        setDestinationSelection({
          description: label,
          place_id: String(top.place_id),
          source: 'nominatim',
        })
        const location = { lat: Number(top.lat), lng: Number(top.lon) }
        applyDestinationLocation(label, location)
      } finally {
        setDestinationLoading(false)
      }
      return
    }
    if (value.source === 'geocoder' && value.location) {
      if (!isWithinBounds(value.location.lat, value.location.lng, serviceBounds)) {
        setDestinationError('Only Moose Jaw addresses are supported.')
        setDestinationLoading(false)
        return
      }
      setDestinationSelection(value)
      applyDestinationLocation(value.description, value.location)
      setDestinationLoading(false)
      return
    }
    setDestinationSelection(value)

    setDestinationLoading(true)
    const url = new URL(nominatimLookupUrl)
    url.searchParams.set('format', 'json')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('place_ids', value.place_id)

    try {
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
      if (!response.ok) {
        throw new Error('Address lookup failed.')
      }
      const results = (await response.json()) as NominatimResult[]
      const top = results[0]
      if (!top) {
        setDestinationError('Only Moose Jaw addresses are supported.')
        return
      }
      if (!isMooseJawNominatimResult(top)) {
        setDestinationError('Only Moose Jaw addresses are supported.')
        return
      }
      const location = { lat: Number(top.lat), lng: Number(top.lon) }
      if (!isWithinBounds(location.lat, location.lng, serviceBounds)) {
        setDestinationError('Only Moose Jaw addresses are supported.')
        return
      }
      applyDestinationLocation(buildNominatimLabel(top), location)
    } finally {
      setDestinationLoading(false)
    }
  }

  const boardDirectionsUrl = useMemo(() => {
    if (!addressResult || !addressClosestStop) return null
    const originParam = encodeURIComponent(addressResult.address)
    const destParam = `${addressClosestStop.stop.stop_lat},${addressClosestStop.stop.stop_lon}`
    return `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destParam}&travelmode=walking`
  }, [addressClosestStop, addressResult])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMinutes(getNowMinutes())
    }, 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!addressResult || !destination) return
    const nearest = pickNearestStop(
      eligibleStopsForDestination,
      stops,
      addressResult.location.lat,
      addressResult.location.lng
    )
    if (!nearest) {
      setAddressClosestStop(null)
      setOrigin(null)
      return
    }
    setAddressClosestStop(nearest)
    setOrigin(nearest.stop)
  }, [addressResult, destination, eligibleStopsForDestination, stops])

  const planResult = useMemo(() => {
    if (!origin || !destination) return null
    if (origin.stop_id === destination.stop_id) {
      return { kind: 'error' as const, error: 'Pick two different stops to build a route.' }
    }

    const destinationLocation = destinationResult?.location ?? null
    const pickClosestStopAfterBoard = (
      stopTimes: StopTime[],
      boardIndex: number,
      boardMinutes: number
    ) => {
      if (!destinationLocation) return null
      let closest: { stopTime: StopTime; stop: Stop; distanceKm: number } | null = null
      for (let i = boardIndex + 1; i < stopTimes.length; i += 1) {
        const stopTime = stopTimes[i]
        if (timeToMinutes(stopTime.arrival_time) <= boardMinutes) {
          continue
        }
        const stop = stopById.get(stopTime.stop_id)
        if (!stop) continue
        const distanceKm = haversineDistanceKm(
          stop,
          destinationLocation.lat,
          destinationLocation.lng
        )
        if (!closest || distanceKm < closest.distanceKm) {
          closest = { stopTime, stop, distanceKm }
        }
      }
      return closest
    }

    const candidates: CandidateTrip[] = []
    trips.forEach((trip) => {
      const stopTimes = stopTimesByTrip.get(trip.trip_id)
      if (!stopTimes) return
      const boardIndex = stopTimes.findIndex((time) => time.stop_id === origin.stop_id)
      if (boardIndex < 0) return
      const boardTime = stopTimes[boardIndex]
      let alightTime: StopTime | null = null
      let alightStop: Stop | null = null
      const destinationIndex = stopTimes.findIndex(
        (time, index) => index > boardIndex && time.stop_id === destination.stop_id
      )
      if (destinationIndex >= 0) {
        const candidate = stopTimes[destinationIndex]
        if (timeToMinutes(candidate.arrival_time) > timeToMinutes(boardTime.departure_time)) {
          alightTime = candidate
          alightStop = stopById.get(candidate.stop_id) ?? null
        }
      }
      if (!alightTime || !alightStop) {
        const closest = pickClosestStopAfterBoard(
          stopTimes,
          boardIndex,
          timeToMinutes(boardTime.departure_time)
        )
        if (closest) {
          alightTime = closest.stopTime
          alightStop = closest.stop
        }
      }
      if (!alightTime || !alightStop) return
      if (boardTime.stop_sequence >= alightTime.stop_sequence) return
      const boardStop = stopById.get(boardTime.stop_id)
      if (!boardStop || !alightStop) return
      candidates.push({
        trip,
        route: routeById.get(trip.route_id),
        boardStop,
        alightStop,
        boardTime: boardTime.departure_time,
        alightTime: alightTime.arrival_time,
        boardSequence: boardTime.stop_sequence,
        alightSequence: alightTime.stop_sequence,
      })
    })

    const sortedByTime = [...candidates].sort(
      (a, b) => timeToMinutes(a.boardTime) - timeToMinutes(b.boardTime)
    )
    if (sortedByTime.length > 0) {
      const upcoming = sortedByTime.filter(
        (candidate) => timeToMinutes(candidate.boardTime) >= nowMinutes
      )
      if (upcoming.length === 0) {
        const [nextTrip, ...alternatives] = sortedByTime
        return {
          kind: 'direct' as const,
          nextTrip,
          alternatives,
          serviceNote: 'No more departures today. Showing the next available trip.',
        }
      }
      const [nextTrip, ...alternatives] = upcoming

      return { kind: 'direct' as const, nextTrip, alternatives }
    }

    const createLeg = (
      trip: Trip,
      boardTime: StopTime,
      alightTime: StopTime
    ): CandidateTrip | null => {
      const boardStop = stopById.get(boardTime.stop_id)
      const alightStop = stopById.get(alightTime.stop_id)
      if (!boardStop || !alightStop) return null
      return {
        trip,
        route: routeById.get(trip.route_id),
        boardStop,
        alightStop,
        boardTime: boardTime.departure_time,
        alightTime: alightTime.arrival_time,
        boardSequence: boardTime.stop_sequence,
        alightSequence: alightTime.stop_sequence,
      }
    }

    const leg2ByStop = new Map<string, CandidateTrip[]>()
    trips.forEach((trip) => {
      const stopTimes = stopTimesByTrip.get(trip.trip_id)
      if (!stopTimes) return
      const destIndex = stopTimes.findIndex((time) => time.stop_id === destination.stop_id)
      if (destIndex <= 0) return
      const alightTime = stopTimes[destIndex]
      for (let i = 0; i < destIndex; i += 1) {
        const boardTime = stopTimes[i]
        const leg2 = createLeg(trip, boardTime, alightTime)
        if (!leg2) continue
        const list = leg2ByStop.get(boardTime.stop_id) ?? []
        list.push(leg2)
        leg2ByStop.set(boardTime.stop_id, list)
      }
    })

    const transferPlans: TransferPlan[] = []
    trips.forEach((trip) => {
      const stopTimes = stopTimesByTrip.get(trip.trip_id)
      if (!stopTimes) return
      const originIndex = stopTimes.findIndex((time) => time.stop_id === origin.stop_id)
      if (originIndex < 0 || originIndex >= stopTimes.length - 1) return
      const boardTime = stopTimes[originIndex]
      for (let i = originIndex + 1; i < stopTimes.length; i += 1) {
        const alightTime = stopTimes[i]
        const leg1 = createLeg(trip, boardTime, alightTime)
        if (!leg1) continue
        const leg2Options = leg2ByStop.get(alightTime.stop_id)
        if (!leg2Options) continue
        for (const leg2 of leg2Options) {
          const layover = minutesBetween(leg1.alightTime, leg2.boardTime)
          if (layover < 0) continue
          const totalMinutes = minutesBetween(leg1.boardTime, leg2.alightTime)
          if (totalMinutes < 0) continue
          transferPlans.push({
            firstLeg: leg1,
            secondLeg: leg2,
            transferStop: leg1.alightStop,
            layoverMinutes: layover,
            totalMinutes,
          })
        }
      }
    })

    if (transferPlans.length === 0) {
      return { kind: 'error' as const, error: 'No trips found between those stops.' }
    }

    const sortedTransfers = [...transferPlans].sort((a, b) => {
      const timeDiff = timeToMinutes(a.firstLeg.boardTime) - timeToMinutes(b.firstLeg.boardTime)
      if (timeDiff !== 0) return timeDiff
      return a.totalMinutes - b.totalMinutes
    })
    const upcomingTransfers = sortedTransfers.filter(
      (candidate) => timeToMinutes(candidate.firstLeg.boardTime) >= nowMinutes
    )
    if (upcomingTransfers.length === 0) {
      const [nextTransfer, ...alternatives] = sortedTransfers
      return {
        kind: 'transfer' as const,
        nextTransfer,
        alternatives,
        serviceNote: 'No more departures today. Showing the next available trip.',
      }
    }
    const [nextTransfer, ...alternatives] = upcomingTransfers

    return { kind: 'transfer' as const, nextTransfer, alternatives }
  }, [
    destination,
    destinationResult,
    nowMinutes,
    origin,
    routeById,
    stopById,
    stopTimesByTrip,
    trips,
  ])

  const alightDirectionsUrl = useMemo(() => {
    if (!destinationResult || !planResult) return null
    const alightStop =
      planResult.kind === 'direct'
        ? planResult.nextTrip.alightStop
        : planResult.kind === 'transfer'
          ? planResult.nextTransfer.secondLeg.alightStop
          : null
    if (!alightStop) return null
    const originParam = `${alightStop.stop_lat},${alightStop.stop_lon}`
    const destParam = encodeURIComponent(destinationResult.address)
    return `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destParam}&travelmode=walking`
  }, [destinationResult, planResult])

  const alightWalkDistanceKm = useMemo(() => {
    if (!destinationResult || !planResult) return null
    const alightStop =
      planResult.kind === 'direct'
        ? planResult.nextTrip.alightStop
        : planResult.kind === 'transfer'
          ? planResult.nextTransfer.secondLeg.alightStop
          : null
    if (!alightStop) return null
    return haversineDistanceKm(
      alightStop,
      destinationResult.location.lat,
      destinationResult.location.lng
    )
  }, [destinationResult, planResult])

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by this browser.')
      return
    }
    if (!window.isSecureContext) {
      setGeoError('Location access requires HTTPS or localhost.')
      return
    }
    if (stops.length === 0) {
      setGeoError('Stops data is not available yet. Please try again.')
      return
    }
    setGeolocating(true)
    setGeoError(null)
    setAddressLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        setAddressOptions([])
        setAddressSelection(null)
        setAddressResult(null)
        setAddressClosestStop(null)
        const location = { lat: latitude, lng: longitude }
        if (!isWithinBounds(location.lat, location.lng, serviceBounds)) {
          setGeoError('Your location is outside Moose Jaw transit service area.')
          setGeolocating(false)
          setAddressLoading(false)
          return
        }
        let address = 'Current location'
        try {
          const reverseUrl = new URL(nominatimReverseUrl)
          reverseUrl.searchParams.set('format', 'json')
          reverseUrl.searchParams.set('lat', latitude.toString())
          reverseUrl.searchParams.set('lon', longitude.toString())
          reverseUrl.searchParams.set('zoom', '18')
          reverseUrl.searchParams.set('addressdetails', '1')
          const response = await fetch(reverseUrl.toString(), {
            headers: { Accept: 'application/json' },
          })
          if (response.ok) {
            const result = (await response.json()) as NominatimReverseResult
            if (!isMooseJawLocality(getNominatimLocality(result.address))) {
              if (!normalize(result.display_name).includes(mooseJawName)) {
                setGeoError('Your location is outside Moose Jaw transit service area.')
                setGeolocating(false)
                setAddressLoading(false)
                return
              }
            }
            if (result.display_name) {
              address = result.display_name
              setAddressSelection({
                description: result.display_name,
                place_id: String(result.place_id),
                source: 'nominatim',
              })
            }
          }
        } catch {
          // If reverse geocoding fails, keep a simple label.
        }
        setAddressInput(address)
        applyAddressLocation(address, location)
        setGeolocating(false)
        setAddressLoading(false)
      },
      () => {
        setGeoError('Unable to access your location. Check browser permissions.')
        setGeolocating(false)
        setAddressLoading(false)
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box className="app-shell">
        <AppBar position="sticky" color="transparent" elevation={0}>
          <Toolbar sx={{ gap: 2 }}>
            <Box className="logo-mark" />
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
              Moose Jaw Transit Guide
            </Typography>
            <Button variant="outlined" color="secondary">
              Service Alerts
            </Button>
          </Toolbar>
        </AppBar>

        <Container sx={{ py: { xs: 4, md: 8 } }}>
          <Grid container spacing={4} alignItems="center">
            <Grid item xs={12} md={12}>
              <Stack spacing={3}>
                <Chip label="Live beta" color="secondary" sx={{ width: 'fit-content' }} />
                <Typography variant="h3" sx={{ fontWeight: 700 }}>
                  Plan faster rides across Moose Jaw.
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  Find the next bus, track the closest stop, and board with confidence.
                </Typography>
              </Stack>
            </Grid>
          </Grid>

          <Grid container spacing={3} sx={{ mt: { xs: 3, md: 6 } }}>
            <Grid item xs={12}>
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 3, md: 4 },
                  borderRadius: 4,
                  background: 'rgba(255, 255, 255, 0.92)',
                  boxShadow: '0 20px 45px rgba(31, 78, 95, 0.15)',
                }}
              >
                <Stack spacing={3}>
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <DirectionsBus color="primary" />
                    <Box>
                      <Typography variant="h5" sx={{ fontWeight: 700 }}>
                        Route planner (GTFS)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Enter your address (or use near me) and a destination address to plan your
                        trip.
                      </Typography>
                    </Box>
                  </Stack>

                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={7}>
                      <Autocomplete
                        freeSolo
                        options={addressOptions}
                        value={addressSelection}
                        inputValue={addressInput}
                          onChange={handleAddressSelect}
                        onInputChange={(_, value, reason) => {
                          setAddressInput(value)
                          setAddressError(null)
                          if (addressTimeout.current) {
                            window.clearTimeout(addressTimeout.current)
                          }
                          if (reason === 'clear') {
                            setAddressOptions([])
                            setAddressSelection(null)
                            setAddressClosestStop(null)
                            setAddressResult(null)
                            setOrigin(null)
                            setAddressLoading(false)
                            return
                          }
                          setAddressLoading(true)
                          addressTimeout.current = window.setTimeout(() => {
                            lookupAddressSuggestions(value)
                          }, 350)
                        }}
                        filterOptions={(options) => options}
                        getOptionLabel={(option) =>
                          typeof option === 'string' ? option : option.description
                        }
                        isOptionEqualToValue={(option, value) =>
                          typeof value !== 'string' && option.place_id === value.place_id
                        }
                        loading={addressLoading}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Enter your address"
                            placeholder="Start with your street address"
                            helperText="We will pick the closest stop on a route once both addresses are set."
                          />
                        )}
                      />
                    </Grid>
                    <Grid item xs={12} md={2}>
                      <Button
                        fullWidth
                        variant="outlined"
                        color="secondary"
                        onClick={handleUseMyLocation}
                        startIcon={
                          geolocating ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <MyLocation />
                          )
                        }
                        disabled={geolocating}
                      >
                        Near me
                      </Button>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <Alert severity="info">
                        Address search uses OpenStreetMap. Closest in-route stops appear after both
                        addresses are set.
                      </Alert>
                    </Grid>
                  </Grid>

                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={9}>
                      <Autocomplete
                        freeSolo
                        options={destinationOptions}
                        value={destinationSelection}
                        inputValue={destinationInput}
                        onInputChange={(_, value, reason) => {
                          setDestinationInput(value)
                          setDestinationError(null)
                          if (destinationTimeout.current) {
                            window.clearTimeout(destinationTimeout.current)
                          }
                          if (reason === 'clear') {
                            setDestinationOptions([])
                            setDestinationSelection(null)
                            setDestinationResult(null)
                            setDestination(null)
                            setDestinationLoading(false)
                            setOrigin(null)
                            setAddressClosestStop(null)
                            return
                          }
                          setDestinationLoading(true)
                          destinationTimeout.current = window.setTimeout(() => {
                            lookupDestinationSuggestions(value)
                          }, 350)
                        }}
                        onChange={handleDestinationSelect}
                        filterOptions={(options) => options}
                        getOptionLabel={(option) =>
                          typeof option === 'string' ? option : option.description
                        }
                        isOptionEqualToValue={(option, value) =>
                          typeof value !== 'string' && option.place_id === value.place_id
                        }
                        loading={destinationLoading}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Destination address"
                            placeholder="Where are you headed?"
                            helperText="We will select the closest stop to your destination."
                          />
                        )}
                      />
                    </Grid>
                  </Grid>

                  {geoError && <Alert severity="warning">{geoError}</Alert>}
                  {addressError && <Alert severity="warning">{addressError}</Alert>}
                  {destinationError && <Alert severity="warning">{destinationError}</Alert>}

                  <Divider />

                  {!origin || !destination ? (
                    <Alert severity="info">
                      Enter both a start and destination address to see boarding times.
                    </Alert>
                  ) : null}

                  {origin && destination && planResult?.kind === 'error' ? (
                    <Alert severity="warning">{planResult.error}</Alert>
                  ) : origin && destination && planResult?.kind === 'direct' ? (
                    <Grid container spacing={2}>
                      {planResult.serviceNote ? (
                        <Grid item xs={12}>
                          <Alert severity="info">{planResult.serviceNote}</Alert>
                        </Grid>
                      ) : null}
                      <Grid item xs={12} md={7}>
                        <Card variant="outlined" sx={{ borderRadius: 3 }}>
                          <CardContent>
                            <Stack spacing={2}>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <Chip
                                  label={`Route ${
                                    planResult.nextTrip.route?.route_short_name ?? 'Local'
                                  }`}
                                  color="secondary"
                                />
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                  {planResult.nextTrip.route?.route_long_name ?? 'Local route'}
                                </Typography>
                              </Stack>
                              <Typography variant="body2" color="text.secondary">
                                Headed toward {planResult.nextTrip.trip.trip_headsign}
                              </Typography>
                              <Stack direction="row" spacing={2} alignItems="center">
                                <Place color="primary" fontSize="small" />
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  Board at {planResult.nextTrip.boardStop.stop_name}
                                </Typography>
                                {boardDirectionsUrl ? (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="secondary"
                                    startIcon={<DirectionsWalk />}
                                    href={boardDirectionsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Walk to stop
                                  </Button>
                                ) : null}
                              </Stack>
                              <Stack direction="row" spacing={2} alignItems="center">
                                <AccessTime color="primary" fontSize="small" />
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  Board at {formatTime(planResult.nextTrip.boardTime)}
                                </Typography>
                              </Stack>
                              <Stack direction="row" spacing={2} alignItems="center">
                                <ArrowForward color="action" fontSize="small" />
                                <Typography variant="body2" color="text.secondary">
                                  Arrive by {formatTime(planResult.nextTrip.alightTime)} at{' '}
                                  {planResult.nextTrip.alightStop.stop_name}
                                </Typography>
                              </Stack>
                              {alightWalkDistanceKm !== null ? (
                                <Stack direction="row" spacing={2} alignItems="center">
                                  <DirectionsWalk color="action" fontSize="small" />
                                  <Typography variant="body2" color="text.secondary">
                                    Walk about {alightWalkDistanceKm.toFixed(2)} km to destination
                                  </Typography>
                                </Stack>
                              ) : null}
                              {alightDirectionsUrl ? (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="secondary"
                                  startIcon={<DirectionsWalk />}
                                  href={alightDirectionsUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Walk from stop to destination
                                </Button>
                              ) : null}
                            </Stack>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={12} md={5}>
                        <Card variant="outlined" sx={{ borderRadius: 3 }}>
                          <CardContent>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                              Other departures
                            </Typography>
                            {planResult.alternatives.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">
                                No other direct trips for this pair.
                              </Typography>
                            ) : (
                              <List dense>
                                {planResult.alternatives.slice(0, 4).map((candidate) => (
                                  <ListItem key={candidate.trip.trip_id}>
                                    <ListItemIcon>
                                      <DirectionsBus color="action" />
                                    </ListItemIcon>
                                    <ListItemText
                                      primary={`Route ${candidate.route?.route_short_name ?? 'Local'} ${formatTime(
                                        candidate.boardTime
                                      )}`}
                                      secondary={`Board at ${candidate.boardStop.stop_name}`}
                                    />
                                  </ListItem>
                                ))}
                              </List>
                            )}
                          </CardContent>
                        </Card>
                      </Grid>
                    </Grid>
                  ) : origin && destination && planResult?.kind === 'transfer' ? (
                    <Grid container spacing={2}>
                      {planResult.serviceNote ? (
                        <Grid item xs={12}>
                          <Alert severity="info">{planResult.serviceNote}</Alert>
                        </Grid>
                      ) : null}
                      <Grid item xs={12} md={7}>
                        <Card variant="outlined" sx={{ borderRadius: 3 }}>
                          <CardContent>
                            <Stack spacing={2.5}>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <Chip
                                  label={`Route ${
                                    planResult.nextTransfer.firstLeg.route?.route_short_name ??
                                    'Local'
                                  }`}
                                  color="secondary"
                                />
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                  First leg to {planResult.nextTransfer.transferStop.stop_name}
                                </Typography>
                              </Stack>
                              <Typography variant="body2" color="text.secondary">
                                Headed toward {planResult.nextTransfer.firstLeg.trip.trip_headsign}
                              </Typography>
                              <Stack direction="row" spacing={2} alignItems="center">
                                <Place color="primary" fontSize="small" />
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  Board at {planResult.nextTransfer.firstLeg.boardStop.stop_name}
                                </Typography>
                                {boardDirectionsUrl ? (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="secondary"
                                    startIcon={<DirectionsWalk />}
                                    href={boardDirectionsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Walk to stop
                                  </Button>
                                ) : null}
                              </Stack>
                              <Stack direction="row" spacing={2} alignItems="center">
                                <AccessTime color="primary" fontSize="small" />
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  Board at {formatTime(planResult.nextTransfer.firstLeg.boardTime)}
                                </Typography>
                              </Stack>
                              <Stack direction="row" spacing={2} alignItems="center">
                                <ArrowForward color="action" fontSize="small" />
                                <Typography variant="body2" color="text.secondary">
                                  Arrive by{' '}
                                  {formatTime(planResult.nextTransfer.firstLeg.alightTime)} at{' '}
                                  {planResult.nextTransfer.transferStop.stop_name}
                                </Typography>
                              </Stack>

                              <Divider />

                              <Stack direction="row" alignItems="center" spacing={1}>
                                <Chip
                                  label={`Route ${
                                    planResult.nextTransfer.secondLeg.route?.route_short_name ??
                                    'Local'
                                  }`}
                                  color="secondary"
                                />
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                  Second leg to{' '}
                                  {planResult.nextTransfer.secondLeg.alightStop.stop_name}
                                </Typography>
                              </Stack>
                              <Typography variant="body2" color="text.secondary">
                                Headed toward {planResult.nextTransfer.secondLeg.trip.trip_headsign}
                              </Typography>
                              <Stack direction="row" spacing={2} alignItems="center">
                                <Place color="primary" fontSize="small" />
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  Board at {planResult.nextTransfer.secondLeg.boardStop.stop_name}
                                </Typography>
                              </Stack>
                              <Stack direction="row" spacing={2} alignItems="center">
                                <AccessTime color="primary" fontSize="small" />
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                  Board at {formatTime(planResult.nextTransfer.secondLeg.boardTime)}
                                </Typography>
                              </Stack>
                              <Stack direction="row" spacing={2} alignItems="center">
                                <ArrowForward color="action" fontSize="small" />
                                <Typography variant="body2" color="text.secondary">
                                  Arrive by{' '}
                                  {formatTime(planResult.nextTransfer.secondLeg.alightTime)} at{' '}
                                  {planResult.nextTransfer.secondLeg.alightStop.stop_name}
                                </Typography>
                              </Stack>
                              {alightWalkDistanceKm !== null ? (
                                <Stack direction="row" spacing={2} alignItems="center">
                                  <DirectionsWalk color="action" fontSize="small" />
                                  <Typography variant="body2" color="text.secondary">
                                    Walk about {alightWalkDistanceKm.toFixed(2)} km to destination
                                  </Typography>
                                </Stack>
                              ) : null}
                              {alightDirectionsUrl ? (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="secondary"
                                  startIcon={<DirectionsWalk />}
                                  href={alightDirectionsUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Walk from stop to destination
                                </Button>
                              ) : null}
                              <Stack direction="row" spacing={2} alignItems="center">
                                <AccessTime color="action" fontSize="small" />
                                <Typography variant="body2" color="text.secondary">
                                  Layover: {Math.round(planResult.nextTransfer.layoverMinutes)} min
                                </Typography>
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid item xs={12} md={5}>
                        <Card variant="outlined" sx={{ borderRadius: 3 }}>
                          <CardContent>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                              Other transfer options
                            </Typography>
                            {planResult.alternatives.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">
                                No other two-leg trips for this pair.
                              </Typography>
                            ) : (
                              <List dense>
                                {planResult.alternatives.slice(0, 4).map((candidate, index) => (
                                  <ListItem key={`${candidate.firstLeg.trip.trip_id}-${index}`}>
                                    <ListItemIcon>
                                      <DirectionsBus color="action" />
                                    </ListItemIcon>
                                    <ListItemText
                                      primary={`Routes ${
                                        candidate.firstLeg.route?.route_short_name ?? 'Local'
                                      } -> ${candidate.secondLeg.route?.route_short_name ?? 'Local'} - ${formatTime(
                                        candidate.firstLeg.boardTime
                                      )}`}
                                      secondary={`Transfer at ${candidate.transferStop.stop_name}`}
                                    />
                                  </ListItem>
                                ))}
                              </List>
                            )}
                          </CardContent>
                        </Card>
                      </Grid>
                    </Grid>
                  ) : null}
                </Stack>
              </Paper>
            </Grid>

          </Grid>
        </Container>
      </Box>
    </ThemeProvider>
  )
}

export default App




