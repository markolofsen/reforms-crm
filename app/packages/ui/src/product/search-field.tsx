"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { Input } from "../ui/input";
import { cn } from "../cn";

/**
 * The one search box of a list (P127 C1; Mail, Messengers, Knowledge). The address is the state (a search is a link), but it
 * follows `replaceState` a moment late: a box bound only to it dropped letters typed faster than the page caught up (P44 S1
 * measured "Marta Fic" arriving as "Mata Fic" at 30 ms a key). The box keeps what the person typed; the address's value is
 * adopted only while the box is not the one being typed in (Back, a link, Clear). It is the one component that holds a value of
 * the address in state (`state-and-data.md` rule 9's exception, for that reason).
 */
export function SearchField({ value, onChange, label, placeholder = "Search people or messages", className, inputRef }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const own = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(value);
  useEffect(() => {
    if (own.current !== document.activeElement) setText(value);
  }, [value]);
  const setRef = (el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) inputRef.current = el;
  };
  return (
    <Input
      aria-label={label}
      className={cn("control-s w-full", className)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      placeholder={placeholder}
      ref={setRef}
      type="search"
      value={text}
    />
  );
}
