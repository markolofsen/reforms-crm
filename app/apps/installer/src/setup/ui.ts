import * as p from "@clack/prompts";

/** Everything the wizard asks or shows. `undefined` from an input means the person cancelled. Tests script this. */
export interface Ui {
  intro(title: string): void;
  outro(text: string): void;
  note(body: string, title?: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  password(message: string): Promise<string | undefined>;
  text(message: string, opts?: { initial?: string }): Promise<string | undefined>;
  confirm(message: string, initial?: boolean): Promise<boolean | undefined>;
  choose<T extends string>(message: string, options: { value: T; label: string }[]): Promise<T | undefined>;
}

const un = <T>(v: T | symbol): T | undefined => (p.isCancel(v) ? undefined : (v as T));
const unx = (v: unknown): never => un(v as never) as never;

export const clackUi: Ui = {
  intro: (t) => p.intro(t),
  outro: (t) => p.outro(t),
  note: (b, t) => p.note(b, t),
  info: (m) => p.log.info(m),
  warn: (m) => p.log.warn(m),
  password: async (m) => unx(await p.password({ message: m })),
  text: async (m, o) => unx(await p.text({ message: m, ...(o?.initial ? { initialValue: o.initial } : {}) })),
  confirm: async (m, i = false) => unx(await p.confirm({ message: m, initialValue: i })),
  choose: async <T extends string>(m: string, options: { value: T; label: string }[]) => unx(await p.select<T>({ message: m, options: options as never })),
};

/** No prompts at all: any question is a bug in the caller. Used by `--non-interactive`. */
export const quietUi: Ui = {
  intro: (t) => console.log(t),
  outro: (t) => console.log(t),
  note: (b, t) => console.log(`${t ? `[${t}]\n` : ""}${b}`),
  info: (m) => console.log(m),
  warn: (m) => console.log(`warning: ${m}`),
  password: async () => { throw new Error("prompt in non-interactive mode"); },
  text: async () => { throw new Error("prompt in non-interactive mode"); },
  confirm: async () => { throw new Error("prompt in non-interactive mode"); },
  choose: async () => { throw new Error("prompt in non-interactive mode"); },
};
