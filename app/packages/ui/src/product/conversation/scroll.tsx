"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

const BOTTOM_TOLERANCE_PX = 64;

function conversationScrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

/**
 * Keeps a conversation at its newest message while its content grows, without
 * stealing the owner's position after they scroll up to read older messages.
 */
export type ConversationScrollState = {
  atLatest: boolean;
  scrollToLatest: () => void;
};

export function useConversationScroll(contentRef: RefObject<HTMLElement | null>, conversationKey: string | number, initialAtBottom = true): ConversationScrollState {
  const stickToBottom = useRef(initialAtBottom);
  const scrollRef = useRef<HTMLElement | null>(null);
  const [atLatest, setAtLatest] = useState(initialAtBottom);
  const scrollToLatest = useCallback(() => {
    const scroll = scrollRef.current ?? contentRef.current?.closest<HTMLElement>('[data-pane="history"]');
    if (!scroll) return;
    stickToBottom.current = true;
    setAtLatest(true);
    scroll.scrollTo({ behavior: conversationScrollBehavior(), top: scroll.scrollHeight });
  }, [contentRef]);
  useEffect(() => {
    const content = contentRef.current;
    const scroll = content?.closest<HTMLElement>('[data-pane="history"]');
    if (!content || !scroll) return;
    scrollRef.current = scroll;
    stickToBottom.current = initialAtBottom;
    setAtLatest(initialAtBottom);
    const updatePosition = () => {
      const next = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= BOTTOM_TOLERANCE_PX;
      stickToBottom.current = next;
      setAtLatest(next);
    };
    const onScroll = () => updatePosition();
    scroll.addEventListener("scroll", onScroll, { passive: true });
    const frame = window.requestAnimationFrame(() => {
      if (stickToBottom.current) scroll.scrollTop = scroll.scrollHeight;
      updatePosition();
    });
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) scroll.scrollTop = scroll.scrollHeight;
    });
    observer.observe(content);
    return () => {
      window.cancelAnimationFrame(frame);
      scroll.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (scrollRef.current === scroll) scrollRef.current = null;
    };
  }, [contentRef, conversationKey, initialAtBottom]);
  return useMemo(() => ({ atLatest, scrollToLatest }), [atLatest, scrollToLatest]);
}
