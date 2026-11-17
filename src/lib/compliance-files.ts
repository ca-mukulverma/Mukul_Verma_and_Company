// Which return files a filed period needs before it is completed. Shared by
// the server and the compliance screens, so it imports nothing.
//
// A NIL return needs only the return PDF: the JSON is never required for it
// (it can still be attached). The PDF is asked for when the work type needs
// any return file at all.
export function requiredReturnFiles(
  workType: { requirePdf: boolean; requireJson: boolean },
  isNil: boolean | null | undefined
): { pdf: boolean; json: boolean } {
  if (isNil === true) return { pdf: workType.requirePdf || workType.requireJson, json: false };
  return { pdf: workType.requirePdf, json: workType.requireJson };
}
