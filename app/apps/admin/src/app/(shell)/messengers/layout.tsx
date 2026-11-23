import type { ReactNode } from "react";
import { ChatsScreen } from "@/features/messengers/section";

export default function MessengersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ChatsScreen />
      {children}
    </>
  );
}
