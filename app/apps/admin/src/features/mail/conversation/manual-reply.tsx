"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { composerStateOf } from "@hub/contract/composer";
import type { MailComposerContextDto } from "@hub/contract/conversations";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationComposerFooter } from "@hub/ui/product/conversation-frame";
import { ConversationContext, ConversationContextActions, ConversationContextItem, ConversationContextRow } from "@hub/ui/product/conversation-context";
import { ConversationComposerEditor } from "@hub/ui/product/composer-editor";
import { ConversationLabel } from "@hub/ui/product/conversation";
import { IntegrationStatus } from "@hub/ui/product/integration-status";
import type { Notice } from "@/features/review/use-review-actions";
import { refreshData, sentence } from "@/lib/api/client";
import { reviewApi } from "@/lib/api/review";
import { useMailSignature } from "./use-mail-signature";

export function MailComposerNotice({ notice, historyNote }: { notice: Notice | null; historyNote: string | null }) {
  if (!notice && !historyNote) return null;
  return (
    <div className="flex flex-col gap-1">
      <NoticeLine notice={notice} />
      {historyNote && <p className="text-muted-foreground text-xs" data-testid="history-note" role="status">{historyNote} Showing what the Hub recorded.</p>}
    </div>
  );
}

function languageLabel(language: MailComposerContextDto["language"]): string {
  return language === "ru" ? "Russian" : "English";
}

/**
 * The owner's own message (P99, P110), opened by "Write it myself" or "Write again" (P128 X1: the composer rests closed), with focus
 * in the body. It saves one unsent draft and never sends; Close folds it again.
 */
export function MailManualReply({ composer, project, clientId, hasOpenIncoming, notice, historyNote, onClose }: { composer: MailComposerContextDto; project: string; clientId: number; hasOpenIncoming: boolean; notice: Notice | null; historyNote: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const { value, setValue, selected, selectedBrand, chooseBrand, body, language: detectedLanguage, signature: visibleSignature, signatureFallback: visibleSignatureFallback, brandSelectionRequired, pending: pendingSignature, applyPending: applyPendingSignature } = useMailSignature(composer);
  const visibleFrom = selected?.from ?? composer.from;
  const visibleBrand = selected?.name ?? composer.brand;
  const brandSelectionLocked = composer.brand !== null;
  const signaturePlaceholder = visibleSignature.some((line) => /^\[Owner: signature for [^\]]*\]$/i.test(line.trim()));
  const visibleStatus = signaturePlaceholder || selected?.status === "missing_signature" ? "missing_signature" : selected ? composer.status === "needs_brand" ? "resolved" : composer.status : composer.status;
  const visibleReason = visibleStatus === "missing_signature" ? "The selected brand has no configured signature" : selected && composer.status === "needs_brand" ? null : composer.reason;
  const signatureUnavailable = visibleStatus === "missing_signature";
  const mailUnavailable = composer.status === "needs_mail";
  const saveBlocked = mailUnavailable || brandSelectionRequired || signatureUnavailable;
  const create = useMutation({
    mutationFn: (text: string) => reviewApi.createManualDraft(project, clientId, text, selectedBrand),
    onSuccess: () => {
      setValue("");
      setSaved(true);
      void refreshData(qc, { mail: true });
    },
  });
  const changeValue = (next: string) => {
    if (create.isError) create.reset();
    setValue(next);
    setSaved(false);
  };
  const submit = () => {
    const text = value.trim();
    if (!body || !text || create.isPending || pendingSignature || saveBlocked || (composer.status === "needs_brand" && !selectedBrand)) return;
    create.mutate(text);
  };
  const composerState = composerStateOf({
    blocked: brandSelectionRequired ? "Choose a brand before saving this message." : signatureUnavailable ? "Configure a signature for the selected brand before saving." : pendingSignature ? "Apply the selected signature before saving." : null,
    body: value,
    error: create.isError ? sentence(create.error) : null,
    unavailable: composer.status === "needs_mail" ? composer.reason : null,
    saving: create.isPending,
  });
  const composerNotice = !hasOpenIncoming || notice || historyNote ? (
    <>
      {!hasOpenIncoming && <p className="text-muted-foreground text-xs" data-testid="new-thread-note">No incoming message is open. This starts a new unsent draft.</p>}
      {(notice || historyNote) && <MailComposerNotice historyNote={historyNote} notice={notice} />}
    </>
  ) : undefined;
  return (
    <ConversationComposerEditor
      ariaLabel={hasOpenIncoming ? "Reply composer" : "New message composer"}
      beforeEditor={
        <>
          <ConversationContext ariaLabel="Mail context" testId="manual-reply-context">
            <ConversationContextRow>
                <ConversationContextItem label="From" testId="manual-reply-from">{visibleFrom ? <ConversationLabel className="block max-w-full truncate" value={visibleFrom} /> : "Not available"}</ConversationContextItem>
                <ConversationContextItem label="Language" testId="manual-reply-language">{languageLabel(detectedLanguage)}</ConversationContextItem>
                {composer.brands.length > 1 ? (
                  <ConversationContextItem label="Brand">
                    <Menu>
                      <MenuTrigger aria-label={brandSelectionLocked ? "Mail brand detected from the conversation" : visibleBrand ? `Change Mail brand; currently ${visibleBrand}` : "Choose Mail brand"} render={<ActionButton className="max-w-full px-2" disabled={brandSelectionLocked} size="s" tooltip={brandSelectionLocked ? "Brand detected from the incoming Mail headers" : "Choose Mail brand"} variant="quiet" />}>
                        <span className="truncate">{visibleBrand ?? "Choose brand"}</span>
                        {!brandSelectionLocked && <ChevronDownIcon aria-hidden="true" />}
                      </MenuTrigger>
                      <MenuPopup align="start">
                        <MenuRadioGroup onValueChange={(name) => chooseBrand(String(name))} value={selectedBrand ?? ""}>
                          {composer.brands.map((option) => (
                            <MenuRadioItem closeOnClick key={option.name} value={option.name}>
                              <span className="min-w-0 truncate">{option.name}</span>
                              <span className="ms-auto ps-3 text-muted-foreground text-xs">{option.from ?? "From unavailable"}</span>
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </MenuPopup>
                    </Menu>
                  </ConversationContextItem>
                ) : (
                  <ConversationContextItem label="Brand">{visibleBrand ?? "Choose one"}</ConversationContextItem>
                )}
                <ConversationContextItem label="Signature" testId="manual-reply-signature">
                  <IntegrationStatus compact detail={visibleSignature.length > 0 ? `${visibleSignature.join("\n")}${visibleSignatureFallback ? `\n\nUses English fallback for ${languageLabel(visibleSignatureFallback)}.` : ""}` : "No signature is configured for this brand"} label="Signature" state={visibleSignature.length > 0 ? "connected" : "not_found"} />
                </ConversationContextItem>
            </ConversationContextRow>
            {(brandSelectionRequired || visibleSignatureFallback || pendingSignature || visibleStatus !== "resolved") && (
              <ConversationContextActions data-testid="manual-reply-context-actions" tone="warning">
                  {brandSelectionRequired && <span data-testid="brand-selection-note" role="status">Choose a brand before saving.</span>}
                  {visibleSignatureFallback && <span data-testid="signature-fallback" role="status">No {languageLabel(visibleSignatureFallback)} signature; using English.</span>}
                  {pendingSignature && (
                    <ActionButton disabled={create.isPending} onClick={applyPendingSignature} size="s" variant="secondary">
                      Update {pendingSignature.brand} signature{pendingSignature.language === detectedLanguage ? "" : ` for ${languageLabel(pendingSignature.language)}`}
                    </ActionButton>
                  )}
                  {visibleStatus !== "resolved" && !brandSelectionRequired && <span>{visibleReason ?? "Mail context needs attention"}</span>}
              </ConversationContextActions>
            )}
          </ConversationContext>
        </>
      }
      disabled={create.isPending}
      footer={
        <ConversationComposerFooter feedback={create.isError ? <p className="text-destructive-foreground text-sm" role="alert">{sentence(create.error)}</p> : saved ? <p className="text-muted-foreground text-sm" role="status">Draft saved. It remains unsent.</p> : undefined}>
          <ActionButton disabled={!body || create.isPending || pendingSignature !== null || saveBlocked || (composer.status === "needs_brand" && !selectedBrand)} onClick={submit} size="s" tooltip={{ content: "Save unsent draft", hotkey: "Meta/Ctrl + Enter" }} variant="primary">
            {create.isPending ? "Saving draft" : "Save draft"}
          </ActionButton>
          <ActionButton disabled={!value || create.isPending} onClick={() => changeValue("")} size="s" variant="quiet">
            Clear
          </ActionButton>
          <ActionButton disabled={create.isPending} onClick={onClose} size="s" variant="quiet">
            Close
          </ActionButton>
        </ConversationComposerFooter>
      }
      maxLength={20_000}
      notice={composerNotice}
      onChange={changeValue}
      onSubmit={submit}
      autoFocus
      placeholder={hasOpenIncoming ? "Write your reply…" : "Write your message…"}
      state={composerState.state}
      testId="manual-reply"
      title={hasOpenIncoming ? "Write a reply" : "Write a new message"}
      value={value}
    />
  );
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return <p className={notice.kind === "error" ? "text-destructive-foreground text-sm" : "text-warning-foreground text-sm"} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>;
}
