import { createContext, useContext } from "react";

/** The time source. Render never calls `Date.now()`: it reads this, so a test can pin the day. */
export type Clock = () => number;
// eslint-disable-next-line no-restricted-properties -- the one place the real clock is read
export const systemClock: Clock = () => Date.now();

export const ClockContext = createContext<Clock>(systemClock);
export const useClock = (): Clock => useContext(ClockContext);
