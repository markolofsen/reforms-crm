"use client";

import { telegramDestination, whatsappDestination, type Destination } from "@hub/contract/local";
import type { LeadSheetDto } from "@hub/contract/inbound";
import { Badge } from "@hub/ui/badge";
import { Link } from "@hub/ui/link";
import { SectionTitle } from "@hub/ui/product/shell/page";
import { useOpenLink } from "@/components/links/open-link";
import { anchorProps, webLink } from "@/lib/external";

type Channel = NonNullable<LeadSheetDto["channel"]>;
const CHANNEL_NAMES: Record<Channel["kind"], string> = { whatsapp: "WhatsApp", telegram: "Telegram", email: "Email", phone: "Phone", other: "" };

/** Where a contact channel opens (the app, else its web page): WhatsApp and Telegram only; it only opens a chat, nothing is sent. */
export function channelDestination(c: Channel | null): Destination | null {
  if (!c) return null;
  if (c.kind === "whatsapp") return whatsappDestination(c.value);
  if (c.kind === "telegram") return /^\+?[\d\s().-]+$/.test(c.value) ? telegramDestination({ phone: c.value }) : telegramDestination({ username: c.value });
  return null;
}

/** A web value (the company website, a site they named) as a link in a new tab; text when it is not a web page. */
function WebValue({ href, children }: { href: string | null; children: string }) {
  const link = href ? webLink(href) : null;
  if (!link) return <>{children}</>;
  return (
    <Link className="text-base text-foreground underline" {...anchorProps(link)}>
      {children}
    </Link>
  );
}

/** The channel's value: "WhatsApp +971 …" opens the chat in the app (or WhatsApp Web) for the owner to write; never sends. */
function ChannelValue({ channel }: { channel: Channel }) {
  const link = useOpenLink(channelDestination(channel));
  const words = `${CHANNEL_NAMES[channel.kind]}${CHANNEL_NAMES[channel.kind] ? " " : ""}${channel.value}`;
  if (!link) return <>{words}</>;
  return (
    <Link className="text-base text-foreground underline" data-testid="lead-channel-link" {...anchorProps(link)}>
      {words}
    </Link>
  );
}

/**
 * P138 verdicts 1 and 8: what the person wants, the card's body, in body size and never folded. Known fields first (company,
 * website as a link, country by name, segment, expected volume), then the contact channel, then every other field of the form
 * in the same grid; the sites they named as chips (a link when it is a domain) and their message as a quote.
 */
export function LeadWant({ sheet, message }: { sheet: LeadSheetDto; message: string }) {
  const hasRows = sheet.fields.length > 0 || sheet.channel !== null;
  return (
    <section aria-labelledby="lead-want" className="flex flex-col gap-3" data-testid="lead-want">
      <SectionTitle id="lead-want">What they want</SectionTitle>
      {hasRows && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-base sm:grid-cols-[max-content_minmax(0,1fr)]">
          {sheet.fields.map((f, i) => (
            <div className="contents" data-testid="lead-field" key={`${f.label}-${i}`}>
              <dt className="pt-1 text-muted-foreground text-sm sm:pt-0.5">{f.label}</dt>
              <dd className="min-w-0 break-words">
                <WebValue href={f.href}>{f.value}</WebValue>
              </dd>
            </div>
          ))}
          {sheet.channel && (
            <div className="contents" data-testid="lead-field">
              <dt className="pt-1 text-muted-foreground text-sm sm:pt-0.5">Contact channel</dt>
              <dd className="min-w-0 break-words">
                <ChannelValue channel={sheet.channel} />
              </dd>
            </div>
          )}
        </dl>
      )}
      {sheet.sites.length > 0 && (
        <ul aria-label="Sites they named" className="flex flex-wrap gap-1.5" data-testid="lead-sites">
          {sheet.sites.map((s) => {
            const link = s.href ? webLink(s.href) : null;
            return (
              <li key={s.name}>
                {link ? (
                  <Badge render={<Link bare {...anchorProps(link)} />} size="lg" variant="outline">
                    {s.name}
                  </Badge>
                ) : (
                  <Badge size="lg" variant="secondary">
                    {s.name}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {message.trim() ? (
        <blockquote className="measure whitespace-pre-wrap break-words border-s-2 ps-3 text-base" data-testid="lead-text">
          {message}
        </blockquote>
      ) : (
        <p className="text-muted-foreground text-sm" data-testid="lead-text">
          No message.
        </p>
      )}
    </section>
  );
}

/** P138 verdict 2: the form's machinery (locale, hosts, consent, environment, tracking) last, smaller and muted, still shown. */
export function LeadTechnical({ rows }: { rows: LeadSheetDto["technical"] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="lead-technical" className="flex flex-col gap-1 border-t pt-3 text-muted-foreground" data-testid="lead-technical">
      <SectionTitle id="lead-technical">Technical</SectionTitle>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        {rows.map((r, i) => (
          <div className="contents" key={`${r.label}-${i}`}>
            <dt>{r.label}</dt>
            <dd className="min-w-0 break-all">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
