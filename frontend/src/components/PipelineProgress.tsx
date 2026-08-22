import CheckRounded from "@mui/icons-material/CheckRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { PIPELINE_STEPS } from "../hooks/useIFlowExternalizer";

export function PipelineProgress({ activeIndex, dryRun, failed }: { activeIndex: number; dryRun: boolean; failed: boolean }) {
  const steps = dryRun ? PIPELINE_STEPS.slice(0, 7) : PIPELINE_STEPS;
  if (activeIndex < 0) return null;
  return <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
    <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>Processing pipeline</Typography>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 1.25 }}>
      {steps.map((step, index) => {
        const complete = index < activeIndex || activeIndex >= steps.length;
        const active = index === activeIndex && !failed;
        const failedStep = failed && index === Math.min(activeIndex, steps.length - 1);
        return <Stack key={step} direction="row" spacing={1.25} alignItems="center" sx={{ color: complete ? "success.main" : failedStep ? "error.main" : active ? "primary.main" : "text.disabled" }}>
          {complete ? <CheckRounded fontSize="small" /> : failedStep ? <CloseRounded fontSize="small" /> : active ? <CircularProgress size={17} /> : <Box sx={{ width: 17, height: 17, borderRadius: "50%", border: 1, borderColor: "currentColor" }} />}
          <Typography variant="body2" color="inherit">{step}</Typography>
        </Stack>;
      })}
    </Box>
  </Paper>;
}
