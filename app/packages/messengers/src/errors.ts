import { HubError } from "@hub/config/errors";
export type MessengersErrorCode =
  | "bad_identifier"
  | "bad_text"
  | "chat_not_allowed"
  | "not_human"
  | "not_authorized"
  | "not_confirmed"
  | "no_send_channel"
  | "adapter_mismatch"
  | "no_token"
  | "bad_login";

/** A refusal with a stable `code`, so a CLI or tool maps it without parsing the message. */
export class MessengersError extends HubError {
  declare readonly code: MessengersErrorCode;
  /** Every code is a state the request cannot change (409), as the routes answered it before P126 E1. */
  constructor(code: MessengersErrorCode, message: string) {
    super("wrong_state", code, message);
    this.name = "MessengersError";
  }
}
