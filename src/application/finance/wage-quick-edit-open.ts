/**
 * One-shot quick-edit open for the wage adjustment form.
 *
 * Parent keeps `quickEditDayKey` only until the editor consumes it. After
 * consume, a later load that refreshes manualAmount/manualComment must not
 * reopen the form or overwrite text the user is already editing.
 */
export function applyWageQuickEditOpen(input: {
  startEditing: boolean;
  manualAmount: number;
  manualComment: string;
  seed: (amount: string, comment: string) => void;
  setEditing: (editing: boolean) => void;
  consume: () => void;
}): void {
  if (!input.startEditing) return;
  input.seed(
    input.manualAmount ? String(input.manualAmount).replace('.', ',') : '',
    input.manualComment,
  );
  input.setEditing(true);
  input.consume();
}
