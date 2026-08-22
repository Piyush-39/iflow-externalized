import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { ExternalizerPage } from "./pages/ExternalizerPage";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0a6ed1", dark: "#0854a0", light: "#4aa1eb" },
    success: { main: "#188918" },
    background: { default: "#f5f7f9", paper: "#ffffff" },
    text: { primary: "#172b3a", secondary: "#526675" },
    divider: "#d9e2e8"
  },
  typography: {
    fontFamily: 'Inter, "72", "Segoe UI", Arial, sans-serif',
    h3: { fontSize: "clamp(1.75rem, 3vw, 2.5rem)", letterSpacing: "-0.025em" },
    h5: { fontSize: "1.2rem" },
    button: { textTransform: "none", fontWeight: 650 }
  },
  shape: { borderRadius: 10 },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 8 } } },
    MuiTableHead: { styleOverrides: { root: { "& .MuiTableCell-root": { fontWeight: 700, color: "#334a5b", backgroundColor: "#f7f9fb" } } } }
  }
});

export default function App() {
  return <ThemeProvider theme={theme}><CssBaseline /><ExternalizerPage /></ThemeProvider>;
}
