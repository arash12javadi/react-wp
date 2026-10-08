/**
 * Saves a `Blob` to the visitor's downloads folder.
 *
 * Its own module rather than a corner of `src/lib/backup.ts`, where it started: the Setup Wizard
 * needs it for the `.env` it hands back at its last step, and importing it from there would pull
 * fflate, the database client and every media uploader into that screen for twelve lines.
 */
export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
