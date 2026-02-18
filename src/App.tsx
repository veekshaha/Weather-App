import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import './App.css'

const OPENWEATHER_API_KEY =
  (import.meta.env.VITE_OPENWEATHER_API_KEY as string | undefined) ??
  'b41041e3afb56d1f28980fed79937920'

type Units = 'metric' | 'imperial'

type WeatherMain = 'Clear' | 'Clouds' | 'Rain' | 'Drizzle' | 'Snow' | 'Thunderstorm' | 'Mist' | 'Fog' | 'Haze' | 'Smoke' | 'Dust' | 'Sand' | 'Ash' | 'Squall' | 'Tornado' | string

type BackgroundKind = 'sunny' | 'rain' | 'snow' | 'storm' | 'cloudy'

interface OneCallCurrent {
  dt: number
  sunrise: number
  sunset: number
  temp: number
  feels_like: number
  humidity: number
  wind_speed: number
  weather: { id: number; main: WeatherMain; description: string; icon: string }[]
}

interface OneCallDaily {
  dt: number
  temp: { min: number; max: number; day: number }
  weather: { id: number; main: WeatherMain; description: string; icon: string }[]
}

interface OneCallResponse {
  lat: number
  lon: number
  timezone: string
  timezone_offset: number
  current: OneCallCurrent
  daily: OneCallDaily[]
}

interface ResolvedWeather {
  locationName: string
  countryCode?: string
  current: OneCallCurrent
  daily: OneCallDaily[]
  timezoneOffset: number
  lat: number
  lon: number
}

interface GeocodingResult {
  name: string
  lat: number
  lon: number
  country?: string
  state?: string
}

type FetchState = 'idle' | 'loading' | 'success' | 'error'

type SearchMode = 'city' | 'geo'

function classifyBackground(main: WeatherMain, weatherId: number): BackgroundKind {
  if (weatherId >= 200 && weatherId < 300) return 'storm'
  if (weatherId >= 600 && weatherId < 700) return 'snow'
  if (weatherId >= 500 && weatherId < 600) return 'rain'
  if (weatherId === 800) return 'sunny'
  if (weatherId === 801 || weatherId === 802) return 'sunny'
  if (weatherId >= 803 && weatherId <= 804) return 'cloudy'
  if (['Drizzle', 'Rain'].includes(main)) return 'rain'
  if (['Snow'].includes(main)) return 'snow'
  if (['Thunderstorm'].includes(main)) return 'storm'
  return 'cloudy'
}

function formatTime(dt: number, offsetSeconds: number): string {
  const localMs = (dt + offsetSeconds) * 1000
  const date = new Date(localMs)
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDay(dt: number, offsetSeconds: number): string {
  const localMs = (dt + offsetSeconds) * 1000
  const date = new Date(localMs)
  return date.toLocaleDateString([], { weekday: 'short' })
}

function temperatureUnit(units: Units) {
  return units === 'metric' ? '°C' : '°F'
}

async function geocodeCity(query: string): Promise<GeocodingResult | null> {
  // Trim and validate API key
  const apiKey = OPENWEATHER_API_KEY.trim()
  if (!apiKey || apiKey.length < 20) {
    throw new Error('API key appears to be invalid or missing')
  }

  const url = new URL('https://api.openweathermap.org/geo/1.0/direct')
  url.searchParams.set('q', query.trim())
  url.searchParams.set('limit', '1')
  url.searchParams.set('appid', apiKey)

  try {
    const requestUrl = url.toString()
    const resp = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    })
    
    if (!resp.ok) {
      let errorMessage = `HTTP ${resp.status}`
      try {
        const errorData = await resp.json()
        errorMessage = errorData.message || errorData.cod || errorMessage
        console.error('Geocoding API error response:', errorData)
      } catch {
        const errorText = await resp.text()
        errorMessage = errorText || errorMessage
        console.error('Geocoding API error (text):', errorText)
      }
      
      if (resp.status === 401) {
        throw new Error(`API key authentication failed: ${errorMessage}. Please verify your API key is correct and activated at https://home.openweathermap.org/api_keys`)
      }
      throw new Error(`Geocoding API error (${resp.status}): ${errorMessage}`)
    }
    
    const data = (await resp.json()) as GeocodingResult[]
    if (!data.length) return null
    return data[0]
  } catch (err: any) {
    console.error('Geocoding error:', err)
    if (err.message) {
      throw err
    }
    throw new Error(`Failed to geocode city: ${err.toString()}`)
  }
}

async function reverseGeocode(lat: number, lon: number): Promise<GeocodingResult | null> {
  const apiKey = OPENWEATHER_API_KEY.trim()
  const url = new URL('https://api.openweathermap.org/geo/1.0/reverse')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('limit', '1')
  url.searchParams.set('appid', apiKey)

  try {
    const resp = await fetch(url.toString())
    if (!resp.ok) {
      console.error('Reverse geocoding API error:', resp.status)
      return null
    }
    const data = (await resp.json()) as GeocodingResult[]
    if (!data.length) return null
    return data[0]
  } catch (err) {
    console.error('Reverse geocoding error:', err)
    return null
  }
}

// Free OpenWeather APIs (no subscription required)
interface CurrentWeatherResponse {
  coord: { lat: number; lon: number }
  weather: { id: number; main: string; description: string; icon: string }[]
  main: { temp: number; feels_like: number; humidity: number }
  wind: { speed: number }
  sys: { sunrise: number; sunset: number }
  dt: number
  timezone: number
  name?: string
  cod?: number
  message?: string
}

interface ForecastItem {
  dt: number
  main: { temp: number; temp_min: number; temp_max: number }
  weather: { id: number; main: string; description: string; icon: string }[]
}

interface ForecastResponse {
  list: ForecastItem[]
  city: { timezone: number }
  cod?: number
  message?: string
}

async function fetchWeatherFree(
  lat: number,
  lon: number,
  units: Units,
): Promise<OneCallResponse> {
  const apiKey = OPENWEATHER_API_KEY.trim()
  if (!apiKey || apiKey.length < 20) {
    throw new Error('API key appears to be invalid or missing')
  }

  const currentUrl = new URL('https://api.openweathermap.org/data/2.5/weather')
  currentUrl.searchParams.set('lat', String(lat))
  currentUrl.searchParams.set('lon', String(lon))
  currentUrl.searchParams.set('appid', apiKey)
  currentUrl.searchParams.set('units', units)

  const forecastUrl = new URL('https://api.openweathermap.org/data/2.5/forecast')
  forecastUrl.searchParams.set('lat', String(lat))
  forecastUrl.searchParams.set('lon', String(lon))
  forecastUrl.searchParams.set('appid', apiKey)
  forecastUrl.searchParams.set('units', units)
  forecastUrl.searchParams.set('cnt', '40')

  const [currentResp, forecastResp] = await Promise.all([
    fetch(currentUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } }),
    fetch(forecastUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } }),
  ])

  if (!currentResp.ok) {
    const err = await currentResp.json().catch(() => ({}))
    const msg = (err as { message?: string }).message || `HTTP ${currentResp.status}`
    if (currentResp.status === 401) {
      throw new Error(`Invalid API key: ${msg}. Check your key at https://home.openweathermap.org/api_keys`)
    }
    throw new Error(msg)
  }
  if (!forecastResp.ok) {
    const err = await forecastResp.json().catch(() => ({}))
    const msg = (err as { message?: string }).message || `HTTP ${forecastResp.status}`
    throw new Error(msg)
  }

  const current = (await currentResp.json()) as CurrentWeatherResponse
  const forecast = (await forecastResp.json()) as ForecastResponse

  // Current weather: cod can be 200 (number) or "200" (string) on success
  const currentOk = current.cod === undefined || current.cod === 200 || current.cod === '200'
  if (!currentOk) {
    throw new Error((current as { message?: string }).message || 'Current weather request failed')
  }
  // Forecast: cod can be 200 or "200" on success; if forecast fails we still show current weather
  const forecastOk = forecast.cod === undefined || forecast.cod === 200 || (forecast.cod as string) === '200'
  const forecastList = forecastOk && Array.isArray(forecast.list) ? forecast.list : []
  if (!forecastOk && (forecast as { message?: string }).message) {
    console.warn('Forecast API warning:', (forecast as { message?: string }).message)
  }

  const timezoneOffset = current.timezone ?? (forecast as { city?: { timezone?: number } })?.city?.timezone ?? 0

  const dailyMap = new Map<string, { dt: number; min: number; max: number; day: number; weather: ForecastItem['weather'] }>()
  for (const item of forecastList) {
    const d = new Date(item.dt * 1000)
    const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
    const existing = dailyMap.get(dayKey)
    const temp = item.main.temp
    const min = item.main.temp_min
    const max = item.main.temp_max
    if (!existing) {
      dailyMap.set(dayKey, { dt: item.dt, min, max, day: temp, weather: item.weather })
    } else {
      existing.min = Math.min(existing.min, min)
      existing.max = Math.max(existing.max, max)
      existing.day = temp
      existing.weather = item.weather
    }
  }

  const daily: OneCallDaily[] = Array.from(dailyMap.entries())
    .slice(0, 8)
    .map(([_, v]) => ({
      dt: v.dt,
      temp: { min: v.min, max: v.max, day: v.day },
      weather: v.weather as OneCallDaily['weather'],
    }))

  const oneCall: OneCallResponse = {
    lat: current.coord.lat,
    lon: current.coord.lon,
    timezone: '',
    timezone_offset: timezoneOffset,
    current: {
      dt: current.dt,
      sunrise: current.sys.sunrise,
      sunset: current.sys.sunset,
      temp: current.main.temp,
      feels_like: current.main.feels_like,
      humidity: current.main.humidity,
      wind_speed: current.wind.speed,
      weather: current.weather as OneCallCurrent['weather'],
    },
    daily: daily.length ? daily : [{
      dt: current.dt,
      temp: { min: current.main.temp, max: current.main.temp, day: current.main.temp },
      weather: current.weather as OneCallDaily['weather'],
    }],
  }
  return oneCall
}

async function fetchOneCall(
  lat: number,
  lon: number,
  units: Units,
): Promise<OneCallResponse> {
  return fetchWeatherFree(lat, lon, units)
}

function buildLocationLabel(geo: GeocodingResult | null, fallback: string | null): string {
  if (geo) {
    const parts = [geo.name]
    if (geo.state && geo.state !== geo.name) parts.push(geo.state)
    if (geo.country) parts.push(geo.country)
    return parts.join(', ')
  }
  return fallback ?? 'Current location'
}

function useWeather() {
  const [units, setUnits] = useState<Units>('metric')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('city')
  const [backgroundKind, setBackgroundKind] = useState<BackgroundKind>('cloudy')
  const [fetchState, setFetchState] = useState<FetchState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [weather, setWeather] = useState<ResolvedWeather | null>(null)

  const handleUnitsChange = async (next: Units) => {
    if (next === units) return
    setUnits(next)
    if (!weather) return
    try {
      setFetchState('loading')
      setError(null)
      const fresh = await fetchOneCall(weather.lat, weather.lon, next)
      const head = fresh.current.weather[0]
      setBackgroundKind(classifyBackground(head.main, head.id))
      setWeather({
        locationName: weather.locationName,
        countryCode: weather.countryCode,
        current: fresh.current,
        daily: fresh.daily,
        timezoneOffset: fresh.timezone_offset,
        lat: fresh.lat,
        lon: fresh.lon,
      })
      setFetchState('success')
    } catch (err) {
      console.error(err)
      setFetchState('error')
      setError('Unable to refresh weather for the new unit.')
    }
  }

  useEffect(() => {
    if (!navigator.geolocation) {
      return
    }
    setFetchState('loading')
    setSearchMode('geo')
    navigator.geolocation.getCurrentPosition(
      async position => {
        try {
          const { latitude, longitude } = position.coords
          const oneCall = await fetchOneCall(latitude, longitude, units)
          const geo = await reverseGeocode(latitude, longitude)
          const head = oneCall.current.weather[0]
          setBackgroundKind(classifyBackground(head.main, head.id))
          const locationName = buildLocationLabel(geo, 'Current location')
          setWeather({
            locationName,
            countryCode: geo?.country,
            current: oneCall.current,
            daily: oneCall.daily,
            timezoneOffset: oneCall.timezone_offset,
            lat: oneCall.lat,
            lon: oneCall.lon,
          })
          setFetchState('success')
        } catch (err: any) {
          console.error('Weather fetch error:', err)
          const errorMsg = err?.message || 'Unable to get weather for your location.'
          setFetchState('error')
          setError(`${errorMsg} Please search for a city instead.`)
        }
      },
      (err) => {
        console.error('Geolocation error:', err)
        // Try to load a default city (New York) if geolocation fails
        const loadDefaultCity = async () => {
          try {
            setFetchState('loading')
            console.log('Loading default city: New York')
            const geo = await geocodeCity('New York')
            if (geo) {
              console.log('Found default location:', geo.name)
              const oneCall = await fetchOneCall(geo.lat, geo.lon, units)
              const head = oneCall.current.weather[0]
              setBackgroundKind(classifyBackground(head.main, head.id))
              const locationName = buildLocationLabel(geo, geo.name)
              setWeather({
                locationName,
                countryCode: geo.country,
                current: oneCall.current,
                daily: oneCall.daily,
                timezoneOffset: oneCall.timezone_offset,
                lat: oneCall.lat,
                lon: oneCall.lon,
              })
              setFetchState('success')
            } else {
              console.error('No default city found')
              setFetchState('idle')
            }
          } catch (err: any) {
            console.error('Default city load error:', err)
            setFetchState('idle')
            setError(`Unable to load default city: ${err?.message || 'Unknown error'}`)
          }
        }
        loadDefaultCity()
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const searchByCity = async () => {
    if (!searchQuery.trim()) {
      setError('Please enter a city name')
      return
    }
    try {
      setFetchState('loading')
      setError(null)
      console.log('Searching for city:', searchQuery.trim())
      const geo = await geocodeCity(searchQuery.trim())
      if (!geo) {
        setFetchState('error')
        setError('No results for that city. Try another name.')
        return
      }
      console.log('Found location:', geo.name, geo.lat, geo.lon)
      const oneCall = await fetchOneCall(geo.lat, geo.lon, units)
      console.log('Weather data received:', oneCall)
      const head = oneCall.current.weather[0]
      setBackgroundKind(classifyBackground(head.main, head.id))
      const locationName = buildLocationLabel(geo, geo.name)
      setWeather({
        locationName,
        countryCode: geo.country,
        current: oneCall.current,
        daily: oneCall.daily,
        timezoneOffset: oneCall.timezone_offset,
        lat: oneCall.lat,
        lon: oneCall.lon,
      })
      setFetchState('success')
      setSearchMode('city')
    } catch (err: any) {
      console.error('Search error:', err)
      const errorMsg = err?.message || 'Unable to fetch weather for that city.'
      setFetchState('error')
      setError(errorMsg)
    }
  }

  const refreshWithGeo = async () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not available in this browser.')
      setFetchState('error')
      return
    }
    setFetchState('loading')
    setError(null)
    setSearchMode('geo')
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const { latitude, longitude } = pos.coords
          const oneCall = await fetchOneCall(latitude, longitude, units)
          const head = oneCall.current.weather[0]
          setBackgroundKind(classifyBackground(head.main, head.id))
          const locationName = buildLocationLabel(null, 'Current location')
          setWeather({
            locationName,
            current: oneCall.current,
            daily: oneCall.daily,
            timezoneOffset: oneCall.timezone_offset,
            lat: oneCall.lat,
            lon: oneCall.lon,
          })
          setFetchState('success')
        } catch (err) {
          console.error(err)
          setFetchState('error')
          setError('Unable to refresh weather for your location.')
        }
      },
      () => {
        setFetchState('error')
        setError('Location access was denied.')
      },
    )
  }

  return {
    units,
    setUnits: handleUnitsChange,
    searchQuery,
    setSearchQuery,
    searchMode,
    backgroundKind,
    fetchState,
    error,
    weather,
    searchByCity,
    refreshWithGeo,
  }
}

interface WeatherIconProps {
  main: WeatherMain
  id: number
}

function WeatherIcon({ main, id }: WeatherIconProps) {
  const type = classifyBackground(main, id)

  if (type === 'sunny') {
    return (
      <motion.div
        layout="position"
        initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 150, damping: 16 }}
        style={{ position: 'relative', width: 72, height: 72 }}
      >
        <motion.div
          style={{
            width: 48,
            height: 48,
            borderRadius: '999px',
            background: 'radial-gradient(circle, #fde68a, #f59e0b)',
            boxShadow: '0 0 40px rgba(250, 204, 21, 0.9)',
            position: 'absolute',
            inset: '50%',
            translate: '-50% -50%',
          }}
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        {[0, 45, 90, 135].map(angle => (
          <motion.div
            key={angle}
            style={{
              position: 'absolute',
              inset: '50%',
              translate: '-50% -50%',
              width: 76,
              height: 76,
              borderRadius: '999px',
              border: '2px solid rgba(254, 243, 199, 0.8)',
            }}
            initial={{ rotate: angle }}
            animate={{ rotate: angle + 360 }}
            transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
          />
        ))}
      </motion.div>
    )
  }

  if (type === 'rain') {
    return (
      <motion.div
        layout="position"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 160, damping: 18 }}
        style={{ position: 'relative', width: 80, height: 72 }}
      >
        <motion.div
          style={{
            width: 70,
            height: 40,
            borderRadius: 999,
            background:
              'radial-gradient(circle at 20% 20%, #e5e7eb, #9ca3af 42%, #4b5563 80%)',
            boxShadow: '0 18px 35px rgba(15, 23, 42, 0.9)',
            position: 'absolute',
            top: 4,
            left: 5,
          }}
          animate={{ y: [0, -2, 0] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        {[0, 1, 2, 3].map(i => (
          <motion.div
            key={i}
            style={{
              position: 'absolute',
              top: 40,
              left: 16 + i * 12,
              width: 3,
              height: 20,
              borderRadius: 999,
              background:
                'linear-gradient(to bottom, rgba(125, 211, 252, 0), rgba(56, 189, 248, 0.9))',
              filter: 'drop-shadow(0 0 6px rgba(56, 189, 248, 0.9))',
            }}
            animate={{ y: [0, 16, 0], opacity: [0.1, 1, 0.1] }}
            transition={{
              duration: 0.9 + i * 0.1,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.08,
            }}
          />
        ))}
      </motion.div>
    )
  }

  if (type === 'snow') {
    return (
      <motion.div
        layout="position"
        initial={{ opacity: 0, y: -8, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 150, damping: 18 }}
        style={{ position: 'relative', width: 80, height: 72 }}
      >
        <motion.div
          style={{
            width: 70,
            height: 38,
            borderRadius: 999,
            background:
              'radial-gradient(circle at 20% 20%, #e5e7eb, #cbd5f5 40%, #64748b 80%)',
            boxShadow: '0 14px 28px rgba(15, 23, 42, 0.9)',
            position: 'absolute',
            top: 4,
            left: 5,
          }}
          animate={{ y: [0, -1.6, 0] }}
          transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        {[0, 1, 2, 3].map(i => (
          <motion.div
            key={i}
            style={{
              position: 'absolute',
              top: 44,
              left: 16 + i * 12,
              width: 7,
              height: 7,
              borderRadius: 999,
              border: '1px solid rgba(248, 250, 252, 0.9)',
              boxShadow:
                '0 0 6px rgba(248, 250, 252, 0.95), 0 0 16px rgba(248, 250, 252, 0.6)',
            }}
            animate={{
              y: [0, 10, 18],
              x: [0, i % 2 === 0 ? -4 : 4, 0],
              opacity: [0, 1, 0],
              rotate: [0, i % 2 === 0 ? 45 : -45, 0],
            }}
            transition={{
              duration: 3.5 + i * 0.3,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.18,
            }}
          />
        ))}
      </motion.div>
    )
  }

  if (type === 'storm') {
    return (
      <motion.div
        layout="position"
        initial={{ opacity: 0, y: -10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 160, damping: 20 }}
        style={{ position: 'relative', width: 84, height: 76 }}
      >
        <motion.div
          style={{
            width: 76,
            height: 42,
            borderRadius: 999,
            background:
              'radial-gradient(circle at 18% 20%, #e5e7eb, #9ca3af 32%, #020617 90%)',
            boxShadow:
              '0 16px 40px rgba(15, 23, 42, 1), inset 0 -12px 24px rgba(15, 23, 42, 0.9)',
            position: 'absolute',
            top: 6,
            left: 4,
          }}
          animate={{ y: [0, -1.8, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          style={{
            position: 'absolute',
            left: 32,
            top: 32,
            width: 18,
            height: 32,
            clipPath: 'polygon(40% 0, 65% 40%, 50% 40%, 70% 72%, 30% 100%, 45% 60%, 30% 60%)',
            background: 'linear-gradient(to bottom, #facc15, #f97316)',
            filter: 'drop-shadow(0 0 12px rgba(251, 191, 36, 0.95))',
          }}
          animate={{ opacity: [0.4, 1, 0.1, 1, 0.4] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>
    )
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 160, damping: 18 }}
      style={{ position: 'relative', width: 72, height: 64 }}
    >
      <motion.div
        style={{
          width: 64,
          height: 38,
          borderRadius: 999,
          background:
            'radial-gradient(circle at 18% 20%, #e5e7eb, #cbd5f5 35%, #6b7280 82%)',
          boxShadow: '0 16px 35px rgba(15, 23, 42, 0.9)',
          position: 'absolute',
          top: 4,
          left: 4,
        }}
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.div>
  )
}

function App() {
  const {
    units,
    setUnits,
    searchQuery,
    setSearchQuery,
    searchMode,
    backgroundKind,
    fetchState,
    error,
    weather,
    searchByCity,
    refreshWithGeo,
  } = useWeather()

  const isLoading = fetchState === 'loading'

  const currentSummary = useMemo(() => {
    if (!weather) return null
    const current = weather.current
    const head = current.weather[0]
    return {
      main: head.main,
      description: head.description,
      id: head.id,
    }
  }, [weather])

  const appClassName = `app-shell app-shell--${backgroundKind}`

  const forecastDays = useMemo(
    () => (weather ? weather.daily.slice(1, 6) : []),
    [weather],
  )

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = e => {
    if (e.key === 'Enter') {
      searchByCity()
    }
  }

  return (
    <div className={appClassName}>
      <div className="app-shell__backdrop" />
      <div className="app-shell__blur-layer" />
      <div
        className={[
          'weather-overlay',
          backgroundKind === 'sunny' && 'weather-overlay--sunny',
          backgroundKind === 'rain' && 'weather-overlay--rain',
          backgroundKind === 'snow' && 'weather-overlay--snow',
          backgroundKind === 'storm' && 'weather-overlay--storm',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {backgroundKind === 'sunny' &&
          Array.from({ length: 18 }).map((_, i) => (
            <div
              key={i}
              className="weather-overlay__particle"
              style={{
                top: `${10 + (i * 7) % 80}%`,
                left: `${(i * 23) % 100}%`,
                animationDelay: `${i * 0.45}s`,
              }}
            />
          ))}
        {backgroundKind === 'rain' &&
          Array.from({ length: 26 }).map((_, i) => (
            <div
              key={i}
              className="weather-overlay__particle"
              style={{
                top: `${(i * 17) % 100}%`,
                left: `${(i * 11) % 100}%`,
                animationDelay: `${i * 0.08}s`,
              }}
            />
          ))}
        {backgroundKind === 'snow' &&
          Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="weather-overlay__particle"
              style={{
                top: `${(i * 9) % 100}%`,
                left: `${(i * 19) % 100}%`,
                animationDuration: `${10 + i * 0.4}s`,
              }}
            />
          ))}
        {backgroundKind === 'storm' && (
          <div className="weather-overlay__particle" />
        )}
      </div>

      <main className="app-shell__content">
        <motion.div
          className="glass-panel"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="glass-panel__inner">
            <header
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.9rem',
                marginBottom: '1.3rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '1.2rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span
                    className="chip chip--accent"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <span className="chip-dot" />
                    Live weather
                  </span>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '0.4rem',
                      marginTop: '0.1rem',
                    }}
                  >
                    <h1
                      className="text-gradient"
                      style={{
                        fontSize: '1.7rem',
                        lineHeight: 1.1,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      Temp Tales
                    </h1>
                  </div>
                  <span
                    style={{
                      fontSize: '0.84rem',
                      color: 'var(--text-subtle)',
                      maxWidth: 320,
                    }}
                  >
                    A calm, glassy snapshot of your sky – powered by OpenWeather.
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: '0.5rem',
                    minWidth: 0,
                    flex: '0 0 auto',
                  }}
                >
                  <div className="metric-toggle">
                    <button
                      type="button"
                      className={`metric-toggle__option ${
                        units === 'metric' ? 'metric-toggle__option--active' : ''
                      }`}
                      onClick={() => setUnits('metric')}
                    >
                      °C
                    </button>
                    <button
                      type="button"
                      className={`metric-toggle__option ${
                        units === 'imperial' ? 'metric-toggle__option--active' : ''
                      }`}
                      onClick={() => setUnits('imperial')}
                    >
                      °F
                    </button>
                  </div>
                  <button
                    type="button"
                    className="pill-button"
                    style={{ paddingInline: '0.9rem' }}
                    onClick={refreshWithGeo}
                  >
                    <span className="pill-button__icon" aria-hidden="true">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M12 3V5M12 19V21M5 12H3M21 12H19M6.343 6.343L4.929 4.929M19.071 19.071L17.657 17.657M6.343 17.657L4.929 19.071M19.071 4.929L17.657 6.343"
                          stroke="rgba(148,163,184,0.85)"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                        />
                        <circle
                          cx="12"
                          cy="12"
                          r="4.4"
                          stroke="url(#locStroke)"
                          strokeWidth="1.6"
                        />
                        <defs>
                          <linearGradient
                            id="locStroke"
                            x1="8"
                            y1="8"
                            x2="16"
                            y2="16"
                            gradientUnits="userSpaceOnUse"
                          >
                            <stop stopColor="#38bdf8" />
                            <stop offset="1" stopColor="#f97316" />
                          </linearGradient>
                        </defs>
                      </svg>
                    </span>
                    <span style={{ fontSize: '0.78rem' }}>
                      {searchMode === 'geo' ? 'Using your location' : 'Use my location'}
                    </span>
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.4rem 0.5rem',
                    borderRadius: 999,
                    border: '1px solid var(--glass-border-subtle)',
                    background:
                      'radial-gradient(circle at top left, rgba(148,163,184,0.38), transparent 50%), rgba(15,23,42,0.9)',
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        background:
                          'radial-gradient(circle at top left, rgba(56,189,248,0.22), transparent 60%), rgba(15,23,42,0.96)',
                        boxShadow: '0 10px 24px rgba(15,23,42,0.8)',
                      }}
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M11 5H19"
                          stroke="rgba(148,163,184,0.95)"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <path
                          d="M5 12H19"
                          stroke="rgba(148,163,184,0.95)"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <path
                          d="M8 19H19"
                          stroke="rgba(148,163,184,0.95)"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <circle
                          cx="7"
                          cy="5"
                          r="2.1"
                          stroke="rgba(248,250,252,0.95)"
                          strokeWidth="1.4"
                        />
                        <circle
                          cx="16"
                          cy="12"
                          r="2.1"
                          stroke="rgba(248,250,252,0.95)"
                          strokeWidth="1.4"
                        />
                        <circle
                          cx="10"
                          cy="19"
                          r="2.1"
                          stroke="rgba(248,250,252,0.95)"
                          strokeWidth="1.4"
                        />
                      </svg>
                    </span>
                    <input
                      type="text"
                      placeholder="Search city (e.g. San Francisco, Tokyo)…"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={handleKeyDown}
                      style={{
                        flex: 1,
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        color: 'var(--text-main)',
                        fontSize: '0.92rem',
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="pill-button pill-button--primary"
                    onClick={searchByCity}
                    disabled={isLoading}
                    style={{
                      opacity: isLoading ? 0.75 : 1,
                      pointerEvents: isLoading ? 'none' : 'auto',
                    }}
                  >
                    <span className="pill-button__glow" />
                    <span className="pill-button__icon" aria-hidden="true">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M5 12.5L9.5 17L19 7.5"
                          stroke="rgba(15,23,42,0.9)"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span style={{ fontSize: '0.82rem' }}>
                      {isLoading ? 'Fetching…' : 'Show weather'}
                    </span>
                  </button>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-subtle)' }}>
                    Powered by OpenWeather One Call 3.0
                  </span>
                  {weather && (
                    <span
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-subtle)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background:
                            fetchState === 'success'
                              ? 'rgba(52,211,153,0.95)'
                              : 'rgba(148,163,184,0.8)',
                          boxShadow:
                            fetchState === 'success'
                              ? '0 0 0 4px rgba(52,211,153,0.35)'
                              : '0 0 0 3px rgba(148,163,184,0.35)',
                        }}
                      />
                      Live from {weather.locationName}
                    </span>
                  )}
                </div>
              </div>
            </header>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.3fr)',
                gap: '1.1rem',
              }}
            >
              <section
                aria-label="Current weather"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1.1fr)',
                  gap: '1.1rem',
                }}
              >
                <motion.div
                  layout
                  transition={{ type: 'spring', stiffness: 160, damping: 18 }}
                  style={{
                    padding: '1rem 1.1rem 1.05rem',
                    borderRadius: 'var(--radius-xl)',
                    border: '1px solid var(--glass-border)',
                    background:
                      'radial-gradient(circle at top left, rgba(148,163,184,0.35), transparent 55%), rgba(15,23,42,0.96)',
                    boxShadow: '0 18px 40px rgba(15,23,42,0.9)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem',
                    minHeight: 148,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '0.8rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: '0.35rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={weather?.current.temp ?? 'no-temp'}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.25 }}
                            style={{
                              fontSize: '2.7rem',
                              lineHeight: 1,
                              letterSpacing: '-0.06em',
                              color: 'var(--text-strong)',
                            }}
                          >
                            {weather
                              ? Math.round(weather.current.temp)
                              : isLoading
                                ? '–'
                                : '—'}
                            <span
                              style={{
                                fontSize: '1.1rem',
                                marginLeft: 2,
                                color: 'var(--text-subtle)',
                              }}
                            >
                              {temperatureUnit(units)}
                            </span>
                          </motion.span>
                        </AnimatePresence>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        {currentSummary && (
                          <span
                            style={{
                              fontSize: '0.95rem',
                              textTransform: 'capitalize',
                              color: 'var(--text-main)',
                            }}
                          >
                            {currentSummary.description}
                          </span>
                        )}
                        {weather && (
                          <span
                            style={{
                              fontSize: '0.8rem',
                              color: 'var(--text-subtle)',
                            }}
                          >
                            Feels like {Math.round(weather.current.feels_like)}
                            {temperatureUnit(units)}
                          </span>
                        )}
                      </div>
                      {weather && (
                        <span
                          style={{
                            fontSize: '0.82rem',
                            color: 'var(--text-subtle)',
                          }}
                        >
                          Humidity {weather.current.humidity}% · Wind{' '}
                          {Math.round(weather.current.wind_speed)}
                          {units === 'metric' ? ' m/s' : ' mph'}
                        </span>
                      )}
                    </div>

                    <div style={{ flexShrink: 0 }}>
                      {currentSummary ? (
                        <WeatherIcon
                          main={currentSummary.main}
                          id={currentSummary.id}
                        />
                      ) : (
                        <div
                          className="skeleton"
                          style={{
                            width: 72,
                            height: 72,
                            borderRadius: 24,
                            opacity: isLoading ? 1 : 0,
                            transition: 'opacity 200ms ease',
                          }}
                        />
                      )}
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  layout
                  transition={{ type: 'spring', stiffness: 160, damping: 18 }}
                  style={{
                    padding: '0.9rem 1rem',
                    borderRadius: 'var(--radius-xl)',
                    border: '1px solid var(--glass-border)',
                    background:
                      'radial-gradient(circle at top right, rgba(56,189,248,0.3), transparent 55%), rgba(15,23,42,0.96)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '0.65rem 0.95rem',
                    alignContent: 'space-between',
                    minHeight: 148,
                  }}
                >
                  {weather ? (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.75rem',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-subtle)',
                          }}
                        >
                          Sunrise
                        </span>
                        <span
                          style={{
                            fontSize: '0.98rem',
                            color: 'var(--text-main)',
                          }}
                        >
                          {formatTime(
                            weather.current.sunrise,
                            weather.timezoneOffset,
                          )}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.75rem',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-subtle)',
                          }}
                        >
                          Sunset
                        </span>
                        <span
                          style={{
                            fontSize: '0.98rem',
                            color: 'var(--text-main)',
                          }}
                        >
                          {formatTime(
                            weather.current.sunset,
                            weather.timezoneOffset,
                          )}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.75rem',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-subtle)',
                          }}
                        >
                          Condition
                        </span>
                        <span
                          style={{
                            fontSize: '0.9rem',
                            color: 'var(--text-main)',
                            textTransform: 'capitalize',
                          }}
                        >
                          {currentSummary?.description ?? '—'}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.75rem',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-subtle)',
                          }}
                        >
                          Location
                        </span>
                        <span
                          style={{
                            fontSize: '0.9rem',
                            color: 'var(--text-main)',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                          }}
                        >
                          {weather.locationName}
                        </span>
                      </div>
                    </>
                  ) : (
                    Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <span
                          className="skeleton"
                          style={{ width: '36%', height: 10, borderRadius: 999 }}
                        />
                        <span
                          className="skeleton"
                          style={{ width: '60%', height: 14, borderRadius: 999 }}
                        />
                      </div>
                    ))
                  )}
                </motion.div>
              </section>

              <section
                aria-label="5-day forecast"
                style={{
                  padding: '0.9rem 1rem 0.85rem',
                  borderRadius: 'var(--radius-xl)',
                  border: '1px solid var(--glass-border)',
                  background:
                    'radial-gradient(circle at top left, rgba(15,23,42,0.92), rgba(15,23,42,0.98))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.7rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.6rem',
                    marginBottom: '0.1rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: 500,
                        color: 'var(--text-main)',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      5-day outlook
                    </span>
                    <span
                      style={{
                        fontSize: '0.74rem',
                        color: 'var(--text-subtle)',
                      }}
                    >
                      Swipe horizontally
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--text-subtle)',
                    }}
                  >
                    High / Low
                  </span>
                </div>
                <div className="h-scroll">
                  {forecastDays.length ? (
                    forecastDays.map(day => (
                      <motion.div
                        key={day.dt}
                        layout
                        whileHover={{ y: -4, scale: 1.02 }}
                        transition={{
                          type: 'spring',
                          stiffness: 220,
                          damping: 18,
                        }}
                        style={{
                          minWidth: 96,
                          padding: '0.5rem 0.6rem 0.55rem',
                          borderRadius: 18,
                          border: '1px solid var(--glass-border-subtle)',
                          background:
                            'radial-gradient(circle at top, rgba(148,163,184,0.42), transparent 60%), rgba(15,23,42,0.96)',
                          boxShadow: '0 12px 26px rgba(15,23,42,0.9)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.82rem',
                            color: 'var(--text-main)',
                          }}
                        >
                          {formatDay(day.dt, weather!.timezoneOffset)}
                        </span>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-subtle)',
                            textTransform: 'capitalize',
                          }}
                        >
                          {day.weather[0]?.description}
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.35rem',
                            marginTop: 4,
                          }}
                        >
                          <span
                            style={{
                              fontSize: '0.92rem',
                              color: 'var(--text-strong)',
                              fontWeight: 500,
                            }}
                          >
                            {Math.round(day.temp.max)}
                            {temperatureUnit(units)}
                          </span>
                          <span
                            style={{
                              fontSize: '0.8rem',
                              color: 'var(--text-subtle)',
                            }}
                          >
                            {Math.round(day.temp.min)}
                            {temperatureUnit(units)}
                          </span>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          minWidth: 96,
                          padding: '0.5rem 0.6rem 0.55rem',
                          borderRadius: 18,
                          border: '1px solid var(--glass-border-subtle)',
                          background:
                            'radial-gradient(circle at top, rgba(148,163,184,0.28), transparent 60%), rgba(15,23,42,0.96)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <span
                          className="skeleton"
                          style={{ width: '45%', height: 11, borderRadius: 999 }}
                        />
                        <span
                          className="skeleton"
                          style={{ width: '70%', height: 11, borderRadius: 999 }}
                        />
                        <span
                          className="skeleton"
                          style={{ width: '60%', height: 13, borderRadius: 999 }}
                        />
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            <div style={{ marginTop: '1.1rem' }}>
              <div className="fade-divider" />
              <div
                style={{
                  marginTop: '0.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: '0.76rem', color: 'var(--text-subtle)' }}>
                  Tip: search by city name, then toggle between Celsius and Fahrenheit to
                  compare feels-like.
                </span>
                {fetchState === 'loading' && (
                  <div className="chip">
                    <span
                      className="chip-dot"
                      style={{
                        boxShadow: '0 0 0 3px rgba(56,189,248,0.22)',
                        background: 'rgba(56,189,248,0.9)',
                      }}
                    />
                    Fetching latest weather…
                  </div>
                )}
                {fetchState === 'error' && error && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="chip"
                    style={{
                      borderColor: 'rgba(248,113,113,0.8)',
                      background:
                        'radial-gradient(circle at top left, rgba(248,113,113,0.26), transparent 55%), rgba(15,23,42,0.96)',
                      color: 'var(--text-strong)',
                    }}
                  >
                    <span
                      className="chip-dot"
                      style={{
                        background: 'rgba(248,113,113,0.95)',
                        boxShadow: '0 0 0 4px rgba(248,113,113,0.25)',
                      }}
                    />
                    {error}
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  )
}

export default App
