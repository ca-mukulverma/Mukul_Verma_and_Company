"use client";

import { useCallback, useEffect } from "react";

const MESSAGE = "You have changes that are not saved. Leave without saving?";

// Warns before leaving a form with unsaved changes: closing or reloading the
// tab (the browser's own prompt), and the form's Cancel/Back buttons through
// confirmLeave(). Returns true when it is fine to leave.
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = MESSAGE;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return useCallback(() => !dirty || window.confirm(MESSAGE), [dirty]);
}
