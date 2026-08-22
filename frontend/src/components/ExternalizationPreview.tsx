import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Grid, Paper, Stack, Typography } from "@mui/material";
import type { ExternalizationParameterView } from "../models/externalization";

export function ExternalizationPreview({ parameters }: { parameters: ExternalizationParameterView[] }) {
  const adapters = parameters.filter((item) => item.sourceType === "adapter").length;
  const modifiers = parameters.length - adapters;
  return <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
    <Typography variant="h6" fontWeight={700}>Externalization preview</Typography>
    <Typography color="text.secondary" sx={{ mb: 2 }}>{parameters.length} parameter{parameters.length === 1 ? "" : "s"} will be created.</Typography>
    <Stack direction="row" spacing={1} sx={{ mb: 2 }}><Chip label={`${adapters} adapters`} /><Chip label={`${modifiers} Content Modifiers`} /></Stack>
    {parameters.map((parameter) => <Accordion key={parameter.parameterName} disableGutters elevation={0} sx={{ borderTop: 1, borderColor: "divider", "&:before": { display: "none" } }}>
      <AccordionSummary expandIcon={<ExpandMoreRounded />}>
        <Box><Typography fontWeight={600}>{parameter.componentName ?? parameter.componentId}</Typography>
          <Typography variant="body2" color="text.secondary">{parameter.propertyName} · {parameter.parameterName}</Typography></Box>
      </AccordionSummary>
      <AccordionDetails><Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}><PreviewValue label="Before" value={parameter.sensitive ? "Sensitive value" : parameter.originalValue ?? "—"} /></Grid>
        <Grid size={{ xs: 12, md: 6 }}><PreviewValue label="After" value={`{{${parameter.parameterName}}}`} /></Grid>
      </Grid></AccordionDetails>
    </Accordion>)}
  </Paper>;
}

function PreviewValue({ label, value }: { label: string; value: string }) {
  return <Box sx={{ bgcolor: "grey.50", borderRadius: 1.5, p: 1.5 }}><Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ mt: 0.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", wordBreak: "break-word" }}>{value}</Typography></Box>;
}
