export type MessengersErrorCode =
  | "bad_identifier"
  | "bad_text"
  | "chat_not_allowed"
  | "not_human"
  | "not_confirmed"
  | "no_send_channel"
  | "adapter_mismatch"
  | "no_token";

/** A refusal with a stable `code`, so a CLI or tool maps it without parsing the message. */
export class MessengersError extends Error {
  constructor(
    readonly code: MessengersErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MessengersError";
  }
}
