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

type AddressSuggestion = {
  description: string
  place_id: string
}

type AddressResult = {
  address: string
  location: { lat: number; lng: number }
}

declare global {
  interface Window {
    google?: any
  }
}

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
let googleMapsScriptPromise: Promise<void> | null = null

const loadGoogleMaps = (apiKey: string) => {
  if (window.google?.maps?.places) return Promise.resolve()
  if (googleMapsScriptPromise) return googleMapsScriptPromise

  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Maps.'))
    document.head.appendChild(script)
  })

  return googleMapsScriptPromise
}

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

const formatTime = (value: string) => value.slice(0, 5)

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
  const [mapsReady, setMapsReady] = useState(false)
  const [mapsError, setMapsError] = useState<string | null>(null)
  const [addressInput, setAddressInput] = useState('')
  const [addressSelection, setAddressSelection] = useState<AddressSuggestion | null>(null)
  const [addressOptions, setAddressOptions] = useState<AddressSuggestion[]>([])
  const [addressLoading, setAddressLoading] = useState(false)
  const [addressResult, setAddressResult] = useState<AddressResult | null>(null)
  const [addressClosestStop, setAddressClosestStop] = useState<{
    stop: Stop
    distanceKm: number
  } | null>(null)
  const addressTimeout = useRef<number | null>(null)

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

  useEffect(() => {
    if (!googleMapsApiKey) {
      setMapsError('Add a Google Maps API key to enable address search.')
    }
  }, [googleMapsApiKey])

  const ensureMapsReady = async () => {
    if (!googleMapsApiKey) {
      setMapsError('Add a Google Maps API key to enable address search.')
      return false
    }
    try {
      await loadGoogleMaps(googleMapsApiKey)
      setMapsReady(true)
      setMapsError(null)
      return true
    } catch {
      setMapsError('Unable to load Google Maps right now.')
      return false
    }
  }

  const lookupAddressSuggestions = async (query: string) => {
    if (!query.trim()) {
      setAddressOptions([])
      setAddressLoading(false)
      return
    }
    const ready = await ensureMapsReady()
    if (!ready || !window.google?.maps?.places) {
      setAddressLoading(false)
      return
    }

    const service = new window.google.maps.places.AutocompleteService()
    service.getPlacePredictions(
      {
        input: query,
        componentRestrictions: { country: 'ca' },
        types: ['address'],
      },
      (predictions: any[], status: string) => {
        setAddressLoading(false)
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !predictions) {
          setAddressOptions([])
          if (status !== window.google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            setMapsError('Address lookup is unavailable. Try again soon.')
          }
          return
        }
        setMapsError(null)
        setAddressOptions(
          predictions.map((prediction) => ({
            description: prediction.description,
            place_id: prediction.place_id,
          }))
        )
      }
    )
  }

  const handleAddressSelect = async (_: unknown, value: AddressSuggestion | string | null) => {
    setAddressResult(null)
    setAddressClosestStop(null)
    if (!value || typeof value === 'string') {
      setAddressSelection(null)
      return
    }
    setAddressSelection(value)

    const ready = await ensureMapsReady()
    if (!ready || !window.google?.maps?.places) return
    if (stops.length === 0) {
      setMapsError('Stops data is not available yet. Please try again.')
      return
    }

    setAddressLoading(true)
    const service = new window.google.maps.places.PlacesService(document.createElement('div'))
    service.getDetails(
      { placeId: value.place_id, fields: ['formatted_address', 'geometry'] },
      (place: any, status: string) => {
        setAddressLoading(false)
        if (
          status !== window.google.maps.places.PlacesServiceStatus.OK ||
          !place?.geometry?.location
        ) {
          setMapsError('Unable to fetch that address. Try another entry.')
          return
        }
        const location = {
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
        }
        const formattedAddress = place.formatted_address ?? value.description
        const nearest = findNearestStop(stops, location.lat, location.lng)
        setMapsError(null)
        setAddressResult({ address: formattedAddress, location })
        setAddressClosestStop(nearest)
        setOrigin(nearest.stop)
        setClosestStop(null)
      }
    )
  }

  const directionsUrl = useMemo(() => {
    if (!addressResult || !addressClosestStop) return null
    const originParam = encodeURIComponent(addressResult.address)
    const destParam = `${addressClosestStop.stop.stop_lat},${addressClosestStop.stop.stop_lon}`
    return `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destParam}&travelmode=walking`
  }, [addressClosestStop, addressResult])

  const planResult = useMemo(() => {
    if (!origin || !destination) return null
    if (origin.stop_id === destination.stop_id) {
      return { error: 'Pick two different stops to build a route.' }
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

    if (candidates.length === 0) {
      return { error: 'No direct trips found between those stops.' }
    }

    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const sortedByTime = [...candidates].sort(
      (a, b) => timeToMinutes(a.boardTime) - timeToMinutes(b.boardTime)
    )
    const nextTrip =
      sortedByTime.find((candidate) => timeToMinutes(candidate.boardTime) >= nowMinutes) ??
      sortedByTime[0]
    const alternatives = sortedByTime.filter((candidate) => candidate.trip.trip_id !== nextTrip.trip.trip_id)

    return { nextTrip, alternatives }
  }, [destination, origin, routeById, stopById, stopTimesByTrip, trips])

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
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        const nearest = findNearestStop(stops, latitude, longitude)
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
                      <Stack spacing={1}>
                        <Button
                          variant="outlined"
                          color="secondary"
                          onClick={async () => {
                            setAddressInput('')
                            setAddressSelection(null)
                            setAddressOptions([])
                            setAddressResult(null)
                            setAddressClosestStop(null)
                            await ensureMapsReady()
                          }}
                          disabled={mapsReady}
                        >
                          {mapsReady ? 'Address search ready' : 'Enable address search'}
                        </Button>
                        {mapsError && <Alert severity="warning">{mapsError}</Alert>}
                      </Stack>
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
                  ) : planResult && 'error' in planResult ? (
                    <Alert severity="warning">{planResult.error}</Alert>
                  ) : planResult ? (
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={7}>
                        <Card variant="outlined" sx={{ borderRadius: 3 }}>
                          <CardContent>
                            <Stack spacing={2}>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <Chip
                                  label={`Route ${
                                    planResult.nextTrip.route?.route_short_name ?? '–'
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
                                      primary={`Route ${candidate.route?.route_short_name ?? '–'} — ${formatTime(
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
