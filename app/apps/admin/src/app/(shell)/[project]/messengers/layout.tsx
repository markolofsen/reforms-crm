import type { ReactNode } from "react";
import { ChatsScreen } from "@/features/messengers/section";

export default function ProjectMessengersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ChatsScreen />
      {children}
    </>
  );
}
