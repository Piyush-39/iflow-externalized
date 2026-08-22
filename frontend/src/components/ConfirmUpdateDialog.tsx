import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";

export function ConfirmUpdateDialog({ open, iflowId, count, onCancel, onConfirm }: {
  open: boolean; iflowId: string; count: number; onCancel(): void; onConfirm(): void;
}) {
  return <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm" aria-labelledby="confirm-update-title">
    <DialogTitle id="confirm-update-title">Update iFlow?</DialogTitle>
    <DialogContent>
      <Typography>You are about to externalize <strong>{count} parameters</strong> in <strong>{iflowId}</strong>.</Typography>
      <Alert severity="warning" icon={<WarningAmberRounded />} sx={{ mt: 2 }}>
        The original iFlow will be backed up first. This updates only the design-time artifact and does not deploy it.
      </Alert>
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2.5 }}><Button onClick={onCancel} color="inherit">Cancel</Button>
      <Button onClick={onConfirm} variant="contained">Update iFlow</Button></DialogActions>
  </Dialog>;
}
