"use client";

import { ChevronDownIcon, LanguagesIcon } from "lucide-react";
import { useMemo } from "react";
import { cn } from "../cn";
import { ActionButton } from "./action-button";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxLabel, ComboboxList, ComboboxPopup, ComboboxTrigger } from "../ui/combobox";
import { SPEECH_LANGUAGE_ROWS } from "./terminal/speech-language";

type LanguageOption = {
  label: string;
  search: string;
  tag: string;
};

export type LanguagePickerProps = {
  ariaLabel: string;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  id?: string;
  includeClientDefault?: boolean;
  onChange: (value: string | null) => void;
  placeholder?: string;
  value: string | null;
};

const LANGUAGE_OPTIONS: readonly LanguageOption[] = SPEECH_LANGUAGE_ROWS.map((row) => ({
  label: `${row.name} · ${row.region}`,
  search: row.search,
  tag: row.tag,
}));

const CLIENT_LANGUAGE: LanguageOption = {
  label: "Client's language",
  search: "client client's browser default automatic",
  tag: "",
};

export function LanguagePicker({ ariaLabel, className, compact = false, disabled = false, id, includeClientDefault = false, onChange, placeholder = "Search languages", value }: LanguagePickerProps) {
  const options = useMemo(() => includeClientDefault ? [CLIENT_LANGUAGE, ...LANGUAGE_OPTIONS] : LANGUAGE_OPTIONS, [includeClientDefault]);
  const selected = options.find((option) => option.tag === (value ?? "")) ?? null;
  const triggerLabel = selected?.label ?? value ?? "Choose language";

  return (
    <Combobox
      autoHighlight
      disabled={disabled}
      filter={(option, query) => option.search.includes(query.trim().toLocaleLowerCase())}
      isItemEqualToValue={(item, current) => item.tag === current.tag}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.tag}
      items={options}
      onValueChange={(option) => onChange(option?.tag || null)}
      value={selected}
    >
      {compact ? (
        <>
          <ComboboxLabel className="sr-only">{ariaLabel}</ComboboxLabel>
          <ComboboxTrigger aria-label={ariaLabel} render={<ActionButton className={className} disabled={disabled} icon size="s" tooltip={{ content: triggerLabel }} variant="quiet" />}>
            <LanguagesIcon aria-hidden="true" />
            <ChevronDownIcon aria-hidden="true" className="-ms-1 size-3" />
          </ComboboxTrigger>
        </>
      ) : (
        <ComboboxInputGroup className={cn("w-48", className)}>
          <ComboboxInput aria-label={ariaLabel} className="pr-1" id={id} placeholder={selected ? undefined : placeholder} />
          <ComboboxTrigger aria-label={`Open ${ariaLabel}`} className="me-1">
            <ChevronDownIcon aria-hidden="true" className="size-4" />
          </ComboboxTrigger>
        </ComboboxInputGroup>
      )}
      <ComboboxPopup align="start" side={compact ? "top" : "bottom"}>
        {compact && (
          <ComboboxInputGroup className="mx-2 mt-2">
            <ComboboxInput aria-label={`Search ${ariaLabel.toLocaleLowerCase()}`} placeholder={placeholder} />
          </ComboboxInputGroup>
        )}
        <ComboboxEmpty>No language found.</ComboboxEmpty>
        <ComboboxList>
          {(option: LanguageOption) => (
            <ComboboxItem key={option.tag || "client-language"} value={option}>
              <span className="col-start-2 min-w-0 truncate">{option.label}</span>
              {option.tag && <span className="text-muted-foreground text-xs">{option.tag}</span>}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
