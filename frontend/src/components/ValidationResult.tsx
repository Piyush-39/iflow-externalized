import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ShieldRounded from "@mui/icons-material/ShieldRounded";
import { Alert, AlertTitle, Grid, Paper, Stack, Typography } from "@mui/material";
import type { AnalysisResponse } from "../models/externalization";

export function ValidationResult({ result }: { result: AnalysisResponse }) {
  const outcome = result.outcome;
  if (!outcome) return null;
  const created = result.parameters.filter((item) => item.status === "new" && item.applied !== false).length;
  return <Alert severity="success" icon={<CheckCircleRounded />} sx={{ alignItems: "flex-start" }}>
    <AlertTitle>{outcome.uploaded ? "iFlow updated successfully" : "Dry run completed successfully"}</AlertTitle>
    <Typography variant="body2" sx={{ mb: 2 }}>{outcome.uploaded
      ? `${result.iflow.name} was updated at design time. It was not deployed.`
      : "SAP Integration Suite was not modified."}</Typography>
    <Grid container spacing={1.5}>
      <ResultItem label="Externalized" value={String(created)} />
      <ResultItem label="Local validation" value="Passed" />
      <ResultItem label="SAP validation" value={outcome.sapValidation === "passed" ? "Passed" : "Not run"} />
      <ResultItem label="Configuration verification" value={outcome.configurationVerification === "passed" ? "Passed" : "Not run"} />
    </Grid>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}><ShieldRounded fontSize="small" />
      <Typography variant="caption">Backup: {outcome.backupFile} · Deployment performed: No</Typography></Stack>
  </Alert>;
}

function ResultItem({ label, value }: { label: string; value: string }) {
  return <Grid size={{ xs: 6, md: 3 }}><Paper variant="outlined" sx={{ p: 1.25, bgcolor: "rgba(255,255,255,.66)" }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" fontWeight={700}>{value}</Typography>
  </Paper></Grid>;
}
