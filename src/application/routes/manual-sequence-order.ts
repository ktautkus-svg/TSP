/** Move a stop id to a new index; returns the same array reference when unchanged. */
export function moveStopInSequence(sequence: readonly string[], id: string, targetIndex: number): string[] {
  const index = sequence.indexOf(id);
  if (index < 0 || targetIndex < 0 || targetIndex >= sequence.length || targetIndex === index) {
    return sequence as string[];
  }
  const next = [...sequence];
  next.splice(index, 1);
  next.splice(targetIndex, 0, id);
  return next;
}

export function sequencesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
