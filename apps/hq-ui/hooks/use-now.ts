"use client";

import { useEffect, useState } from "react";

/** The clock for "x phút trước" and countdowns: re-renders every 30 s, so render stays pure (no Date.now() in JSX). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
