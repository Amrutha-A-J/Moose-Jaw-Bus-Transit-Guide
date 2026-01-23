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
  IconButton,
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
  Tooltip,
  CircularProgress,
} from '@mui/material'
import {
  AccessTime,
  ArrowForward,
  DirectionsWalk,
  DirectionsBus,
  MyLocation,
  Place,
  SwapVert,
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
}

type AddressResult = {
  address: string
  location: { lat: number; lng: number }
}

type NominatimResult = {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

const nominatimBaseUrl = 'https://nominatim.openstreetmap.org/search'
const nominatimLookupUrl = 'https://nominatim.openstreetmap.org/lookup'

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

const getNowMinutes = () => {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

const formatTime = (value: string) => value.slice(0, 5)
const minutesBetween = (start: string, end: string) => timeToMinutes(end) - timeToMinutes(start)

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
  const [closestStop, setClosestStop] = useState<{ stop: Stop; distanceKm: number } | null>(
    null
  )
  const [addressInput, setAddressInput] = useState('')
  const [addressSelection, setAddressSelection] = useState<AddressSuggestion | null>(null)
  const [addressOptions, setAddressOptions] = useState<AddressSuggestion[]>([])
  const [addressLoading, setAddressLoading] = useState(false)
  const [addressResult, setAddressResult] = useState<AddressResult | null>(null)
  const [addressClosestStop, setAddressClosestStop] = useState<{
    stop: Stop
    distanceKm: number
  } | null>(null)
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes)
  const addressTimeout = useRef<number | null>(null)
  const addressAbort = useRef<AbortController | null>(null)

  const stops = useMemo<Stop[]>(() => {
    return parseCsv(stopsRaw).map((row) => ({
      stop_id: row.stop_id,
      stop_code: row.stop_code,
      stop_name: row.stop_name,
      stop_lat: Number(row.stop_lat),
      stop_lon: Number(row.stop_lon),
    }))
  }, [])

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

  const stopOptions = useMemo(() => {
    return [...stops].sort((a, b) => a.stop_name.localeCompare(b.stop_name))
  }, [stops])

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

    const url = new URL(nominatimBaseUrl)
    url.searchParams.set('format', 'json')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', '5')
    url.searchParams.set('q', query)
    url.searchParams.set('countrycodes', 'ca')

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        throw new Error('Address lookup failed.')
      }
      const results = (await response.json()) as NominatimResult[]
      setAddressOptions(
        results.map((result) => ({
          description: result.display_name,
          place_id: String(result.place_id),
        }))
      )
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setAddressOptions([])
      }
    } finally {
      setAddressLoading(false)
    }
  }

  const applyAddressResult = (top: NominatimResult) => {
    const location = { lat: Number(top.lat), lng: Number(top.lon) }
    const candidateStops = destination ? eligibleStopsForDestination : stops
    if (candidateStops.length === 0) {
      setAddressResult({ address: top.display_name, location })
      setAddressClosestStop(null)
      setOrigin(null)
      setClosestStop(null)
      return
    }
    const nearest = findNearestStop(candidateStops, location.lat, location.lng)
    setAddressResult({ address: top.display_name, location })
    setAddressClosestStop(nearest)
    setOrigin(nearest.stop)
    setClosestStop(null)
  }

  const handleAddressSelect = async (_: unknown, value: AddressSuggestion | string | null) => {
    setAddressResult(null)
    setAddressClosestStop(null)
    if (!value) {
      setAddressSelection(null)
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
      const url = new URL(nominatimBaseUrl)
      url.searchParams.set('format', 'json')
      url.searchParams.set('addressdetails', '1')
      url.searchParams.set('limit', '1')
      url.searchParams.set('q', query)
      url.searchParams.set('countrycodes', 'ca')
      try {
        const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
        if (!response.ok) {
          throw new Error('Address lookup failed.')
        }
        const results = (await response.json()) as NominatimResult[]
        const top = results[0]
        if (!top) {
          return
        }
        setAddressSelection({
          description: top.display_name,
          place_id: String(top.place_id),
        })
        if (stops.length === 0) {
          return
        }
        applyAddressResult(top)
      } finally {
        setAddressLoading(false)
      }
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
        return
      }
      applyAddressResult(top)
    } finally {
      setAddressLoading(false)
    }
  }

  const directionsUrl = useMemo(() => {
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

  const planResult = useMemo(() => {
    if (!origin || !destination) return null
    if (origin.stop_id === destination.stop_id) {
      return { kind: 'error' as const, error: 'Pick two different stops to build a route.' }
    }

    const candidates: CandidateTrip[] = []
    trips.forEach((trip) => {
      const stopTimes = stopTimesByTrip.get(trip.trip_id)
      if (!stopTimes) return
      const boardTime = stopTimes.find((time) => time.stop_id === origin.stop_id)
      const alightTime = stopTimes.find((time) => time.stop_id === destination.stop_id)
      if (!boardTime || !alightTime) return
      if (boardTime.stop_sequence >= alightTime.stop_sequence) return
      const boardStop = stopById.get(boardTime.stop_id)
      const alightStop = stopById.get(alightTime.stop_id)
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
        return { kind: 'error' as const, error: 'No more departures today from this stop.' }
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
      return { kind: 'error' as const, error: 'No more departures today from this stop.' }
    }
    const [nextTransfer, ...alternatives] = upcomingTransfers

    return { kind: 'transfer' as const, nextTransfer, alternatives }
  }, [destination, nowMinutes, origin, routeById, stopById, stopTimesByTrip, trips])

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
    const candidateStops = destination ? eligibleStopsForDestination : stops
    if (candidateStops.length === 0) {
      setGeoError('No stops found that serve that destination.')
      return
    }
    setGeolocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        const nearest = findNearestStop(candidateStops, latitude, longitude)
        setOrigin(nearest.stop)
        setClosestStop(nearest)
        setGeolocating(false)
      },
      () => {
        setGeoError('Unable to access your location. Check browser permissions.')
        setGeolocating(false)
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
            <Grid item xs={12} md={6}>
              <Stack spacing={3}>
                <Chip label="Live beta" color="secondary" sx={{ width: 'fit-content' }} />
                <Typography variant="h3" sx={{ fontWeight: 700 }}>
                  Plan faster rides across Moose Jaw.
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  Find the next bus, track the closest stop, and board with confidence.
                </Typography>
                <Stack direction="row" spacing={2}>
                  <Button variant="contained">Find my route</Button>
                  <Button variant="outlined">View schedules</Button>
                </Stack>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card className="hero-card">
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    Today
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700, mt: 1 }}>
                    Downtown loop running every 12 minutes
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Track stop 14: Main & River to catch the next inbound bus.
                  </Typography>
                  <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
                    <Button size="small" variant="contained">
                      Track stop
                    </Button>
                    <Button size="small" variant="text">
                      See alerts
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
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
                        Select a start and end stop to see which bus to board and when.
                      </Typography>
                    </Box>
                  </Stack>

                  <Grid container spacing={2}>
                    <Grid item xs={12} md={8}>
                      <Autocomplete
                        freeSolo
                        options={addressOptions}
                        value={addressSelection}
                        inputValue={addressInput}
                          onChange={handleAddressSelect}
                        onInputChange={(_, value, reason) => {
                          setAddressInput(value)
                          if (addressTimeout.current) {
                            window.clearTimeout(addressTimeout.current)
                          }
                          if (reason === 'clear') {
                            setAddressOptions([])
                            setAddressSelection(null)
                            setAddressClosestStop(null)
                            setAddressResult(null)
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
                            helperText="We will suggest your closest stop and set it as your start."
                          />
                        )}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Alert severity="info">
                        Address search uses OpenStreetMap Nominatim results.
                      </Alert>
                    </Grid>
                  </Grid>

                  {addressClosestStop && addressResult && (
                    <Alert
                      severity="success"
                      action={
                        directionsUrl ? (
                          <Button
                            size="small"
                            color="secondary"
                            variant="outlined"
                            startIcon={<DirectionsWalk />}
                            href={directionsUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Walking directions
                          </Button>
                        ) : null
                      }
                    >
                      Closest stop to {addressResult.address}: {addressClosestStop.stop.stop_name}{' '}
                      ({addressClosestStop.distanceKm.toFixed(2)} km away). Start stop set.
                    </Alert>
                  )}

                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={5}>
                      <Autocomplete
                        options={stopOptions}
                        value={origin}
                        onChange={(_, value) => {
                          setOrigin(value)
                          setClosestStop(null)
                        }}
                        getOptionLabel={(option) => option.stop_name}
                        isOptionEqualToValue={(option, value) =>
                          option.stop_id === value.stop_id
                        }
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Start stop"
                            placeholder="Choose a boarding stop"
                          />
                        )}
                      />
                    </Grid>
                    <Grid item xs={12} md={1} sx={{ textAlign: 'center' }}>
                      <Tooltip title="Swap stops">
                        <span>
                          <IconButton
                            color="primary"
                            onClick={() => {
                              if (!origin && !destination) return
                              setOrigin(destination)
                              setDestination(origin)
                              setClosestStop(null)
                            }}
                          >
                            <SwapVert />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Grid>
                    <Grid item xs={12} md={5}>
                      <Autocomplete
                        options={stopOptions}
                        value={destination}
                        onChange={(_, value) => setDestination(value)}
                        getOptionLabel={(option) => option.stop_name}
                        isOptionEqualToValue={(option, value) =>
                          option.stop_id === value.stop_id
                        }
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Destination stop"
                            placeholder="Where are you headed?"
                          />
                        )}
                      />
                    </Grid>
                    <Grid item xs={12} md={1} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                      <Button
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
                  </Grid>

                  {geoError && <Alert severity="warning">{geoError}</Alert>}

                  {closestStop && (
                    <Alert severity="info">
                      Closest stop: {closestStop.stop.stop_name} (
                      {closestStop.distanceKm.toFixed(2)} km away)
                    </Alert>
                  )}

                  <Divider />

                  {!origin || !destination ? (
                    <Alert severity="info">
                      Choose both stops to see boarding times and the best bus to take.
                    </Alert>
                  ) : planResult?.kind === 'error' ? (
                    <Alert severity="warning">{planResult.error}</Alert>
                  ) : planResult?.kind === 'direct' ? (
                    <Grid container spacing={2}>
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
                  ) : planResult?.kind === 'transfer' ? (
                    <Grid container spacing={2}>
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

            {[
              {
                title: 'Smart stops',
                detail: 'Realtime arrivals with crowdsourced feedback.',
              },
              {
                title: 'Flexible planning',
                detail: 'Save frequent trips and compare route options.',
              },
              {
                title: 'Community powered',
                detail: 'Share service updates with riders nearby.',
              },
            ].map((item) => (
              <Grid item xs={12} md={4} key={item.title}>
                <Card className="info-card">
                  <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {item.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {item.detail}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>
    </ThemeProvider>
  )
}

export default App




