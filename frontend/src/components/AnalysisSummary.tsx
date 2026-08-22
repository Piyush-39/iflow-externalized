import ExtensionRounded from "@mui/icons-material/ExtensionRounded";
import PublishedWithChangesRounded from "@mui/icons-material/PublishedWithChangesRounded";
import TaskAltRounded from "@mui/icons-material/TaskAltRounded";
import VisibilityOffRounded from "@mui/icons-material/VisibilityOffRounded";
import { Box, Grid, Paper, Typography } from "@mui/material";
import type { AnalysisSummaryView } from "../models/externalization";

const cards = [
  ["Components", "components", <ExtensionRounded />],
  ["Externalizable", "externalizable", <PublishedWithChangesRounded />],
  ["Already externalized", "alreadyExternalized", <TaskAltRounded />],
  ["Skipped safely", "skipped", <VisibilityOffRounded />]
] as const;

export function AnalysisSummary({ summary }: { summary: AnalysisSummaryView }) {
  return <Grid container spacing={2}>{cards.map(([label, key, icon]) =>
    <Grid key={key} size={{ xs: 6, md: 3 }}><Paper variant="outlined" sx={{ p: 2.25, height: "100%" }}>
      <Box sx={{ color: "primary.main", mb: 1 }}>{icon}</Box>
      <Typography variant="h4" fontWeight={700}>{summary[key]}</Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Paper></Grid>
  )}</Grid>;
}
