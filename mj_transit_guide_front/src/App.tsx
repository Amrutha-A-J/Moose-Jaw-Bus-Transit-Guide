import './App.css'
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  CssBaseline,
  Grid,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme,
} from '@mui/material'

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
                  Find the next bus, track real-time delays, and build routes that
                  work even on winter mornings.
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
