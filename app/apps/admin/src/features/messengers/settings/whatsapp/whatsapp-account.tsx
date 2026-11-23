import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { QueryView } from "@/components/state-views";
import { whatsappApi } from "@/lib/api/messengers/whatsapp";
import { keys } from "@/lib/cache/keys";
import { AccountRow } from "../account-row";
import { qrPath, qrSide } from "./qr";
import { useWhatsApp, useWhatsAppConnect } from "./use-whatsapp";

/** Said once above Connect (decision 0036 point 2), as the Telegram form's: the number is his own, and the risk is his. */
export const WA_RISK_SENTENCE =
  "This links your own, personal WhatsApp number as an unofficial device, like WhatsApp Web. WhatsApp may watch such clients and can ban the number. The Hub reads only the chats you link, never sends by itself, and stops the number at the first warning.";

/** The QR code, drawn from the server's module rows: dark on white in both themes, since a phone camera needs that contrast. */
function QrCode({ size, rows }: { size: number; rows: string[] }) {
  const side = qrSide(size);
  return (
    <svg aria-label="QR code to scan with WhatsApp on your phone" className="size-56 rounded-md bg-white" role="img" shapeRendering="crispEdges" viewBox={`0 0 ${side} ${side}`}>
      <path d={qrPath(rows)} fill="#000" />
    </svg>
  );
}

/** Connect: the risk sentence, then the button; on the owner's click the QR code with how to scan it, until it is scanned. */
function ConnectWhatsApp() {
  const c = useWhatsAppConnect();
  return (
    <div className="flex flex-col gap-3" data-testid="whatsapp-connect">
      <p className="measure text-sm">{WA_RISK_SENTENCE}</p>
      {c.active ? (
        <div className="flex flex-col gap-3">
          {c.qr ? (
            <>
              <QrCode rows={c.qr.rows} size={c.qr.size} />
              <p className="measure text-sm">On your phone open WhatsApp ▸ Settings ▸ Linked devices ▸ Link a device, and scan this code. A new code shows about every 20 seconds.</p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Waiting for WhatsApp...</p>
          )}
          <div>
            <ActionButton onClick={() => void c.cancel()} size="s" variant="quiet">
              Cancel
            </ActionButton>
          </div>
        </div>
      ) : (
        <div>
          <ActionButton disabled={c.busy} onClick={() => void c.connect()} size="s" variant="primary">
            {c.busy ? "Asking WhatsApp" : "Connect"}
          </ActionButton>
        </div>
      )}
      <div className="min-h-5 text-sm">
        <p role="status">{c.done ?? ""}</p>
        <p className="text-destructive-foreground" role="alert">
          {c.alert ?? ""}
        </p>
      </div>
    </div>
  );
}

/**
 * Settings ▸ Messengers, WhatsApp (P71 M5): the linked number with its state and Disconnect, or Connect with its risk sentence
 * and, on his click, the QR code to scan. When the server keeps WhatsApp off (`HUB_MESSENGERS=off`, several projects) its reason
 * is the one line above; Connect still asks the server, whose refusal lands in the alert.
 */
export function WhatsAppAccount({ linked }: { linked?: number }) {
  const q = useWhatsApp();
  return (
    <QueryView loading={<Skeleton className="h-24 w-full rounded-xl" />} query={q} what="WhatsApp">
      {(d) => <WhatsAppAccountBody d={d} linked={linked} />}
    </QueryView>
  );
}

/** The linked numbers, or Connect (the block above owns the read and its states). */
function WhatsAppAccountBody({ d, linked }: { d: NonNullable<ReturnType<typeof useWhatsApp>["data"]>; linked?: number }) {
  if (d.accounts.length > 0)
    return (
      <ul aria-label="WhatsApp numbers" className="flex flex-col divide-y border-y">
        {d.accounts.map((a) => (
          <AccountRow
            a={a}
            channel="whatsapp"
            linked={linked}
            disconnect={whatsappApi.disconnect}
            key={a.account}
            label={`WhatsApp +${a.account}`}
            note="The device is unlinked (it leaves Linked devices on your phone) and its keys are deleted; the linked chats and their messages stay. To read them again, connect and scan a new code."
            statusKey={keys.whatsapp()}
          />
        ))}
      </ul>
    );
  return (
    <div className="flex flex-col gap-2">
      {d.state === "off" && d.reason && <p className="text-muted-foreground text-sm">WhatsApp is off on this server: {d.reason}.</p>}
      <ConnectWhatsApp />
    </div>
  );
}
