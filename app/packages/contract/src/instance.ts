import { z } from "zod";

/**
 * The instance's brand (P48 W0): `name` and `logo` of `config/config.json`, optional. Without a name the admin says "Hub";
 * without a logo it draws a monogram from the name. The logo file is served by `GET /api/instance/logo` (404 when none),
 * so the browser never learns a path.
 */
export const DEFAULT_INSTANCE_NAME = "Hub";

export const instanceDto = z.strictObject({
  name: z.string().min(1),
  hasLogo: z.boolean(),
  /** P61: the server can run `server` Open actions (macOS with `/usr/bin/open`, or the fake opener). False: those buttons are not rendered. */
  localOpen: z.boolean(),
});
export type InstanceDto = z.infer<typeof instanceDto>;
