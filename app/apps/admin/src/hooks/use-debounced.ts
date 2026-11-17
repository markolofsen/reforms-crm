"use client";

import { useEffect, useState } from "react";

/** The value after it has stood still for `ms`: a search box types freely and the server is asked once the typing pauses. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
