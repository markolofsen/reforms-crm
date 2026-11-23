import { versionHashOf, type NewMailVersion, type Repos } from "@hub/db";

/**
 * P120 W4: records one Mail version the Hub wrote, its hash taken from the text the writer answered (decision 0013: the
 * owner's Save and the manual reply bind Checked to this text). Route files call this and import no `@hub/db`.
 */
export const recordVersion = (repos: Pick<Repos, "mailVersions">, v: Omit<NewMailVersion, "hash"> & { text: string }) => {
  const { text, ...row } = v;
  return repos.mailVersions.add({ ...row, hash: versionHashOf(text) });
};
