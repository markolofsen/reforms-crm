export type SpeechLanguage = {
  readonly name: string;
  readonly englishName: string;
  readonly iso: string;
  readonly dialects: readonly { readonly code: string; readonly region: string }[];
};

export const WEB_SPEECH_LANGUAGES: readonly SpeechLanguage[] = [
  { name: "Afrikaans", englishName: "afrikaans", iso: "af", dialects: [{ code: "af-ZA", region: "South Africa" }] },
  { name: "Bahasa Indonesia", englishName: "indonesian", iso: "id", dialects: [{ code: "id-ID", region: "Indonesia" }] },
  { name: "Català", englishName: "catalan", iso: "ca", dialects: [{ code: "ca-ES", region: "Spain" }] },
  { name: "Čeština", englishName: "czech", iso: "cs", dialects: [{ code: "cs-CZ", region: "Czechia" }] },
  { name: "Dansk", englishName: "danish", iso: "da", dialects: [{ code: "da-DK", region: "Denmark" }] },
  { name: "Deutsch", englishName: "german", iso: "de", dialects: [{ code: "de-DE", region: "Germany" }] },
  { name: "English", englishName: "english", iso: "en", dialects: [{ code: "en-US", region: "United States" }, { code: "en-GB", region: "United Kingdom" }, { code: "en-AU", region: "Australia" }, { code: "en-CA", region: "Canada" }, { code: "en-IN", region: "India" }] },
  { name: "Español", englishName: "spanish", iso: "es", dialects: [{ code: "es-ES", region: "España" }, { code: "es-MX", region: "México" }, { code: "es-US", region: "Estados Unidos" }, { code: "es-AR", region: "Argentina" }] },
  { name: "Français", englishName: "french", iso: "fr", dialects: [{ code: "fr-FR", region: "France" }] },
  { name: "Galego", englishName: "galician", iso: "gl", dialects: [{ code: "gl-ES", region: "Spain" }] },
  { name: "Hrvatski", englishName: "croatian", iso: "hr", dialects: [{ code: "hr-HR", region: "Croatia" }] },
  { name: "Italiano", englishName: "italian", iso: "it", dialects: [{ code: "it-IT", region: "Italia" }, { code: "it-CH", region: "Svizzera" }] },
  { name: "日本語", englishName: "japanese", iso: "ja", dialects: [{ code: "ja-JP", region: "Japan" }] },
  { name: "한국어", englishName: "korean", iso: "ko", dialects: [{ code: "ko-KR", region: "Korea" }] },
  { name: "Latviešu", englishName: "latvian", iso: "lv", dialects: [{ code: "lv-LV", region: "Latvia" }] },
  { name: "Lietuvių", englishName: "lithuanian", iso: "lt", dialects: [{ code: "lt-LT", region: "Lithuania" }] },
  { name: "Magyar", englishName: "hungarian", iso: "hu", dialects: [{ code: "hu-HU", region: "Hungary" }] },
  { name: "Nederlands", englishName: "dutch", iso: "nl", dialects: [{ code: "nl-NL", region: "Netherlands" }] },
  { name: "Norsk bokmål", englishName: "norwegian", iso: "nb", dialects: [{ code: "nb-NO", region: "Norway" }] },
  { name: "Polski", englishName: "polish", iso: "pl", dialects: [{ code: "pl-PL", region: "Poland" }] },
  { name: "Português", englishName: "portuguese", iso: "pt", dialects: [{ code: "pt-BR", region: "Brasil" }, { code: "pt-PT", region: "Portugal" }] },
  { name: "Română", englishName: "romanian", iso: "ro", dialects: [{ code: "ro-RO", region: "Romania" }] },
  { name: "Русский", englishName: "russian", iso: "ru", dialects: [{ code: "ru-RU", region: "Russia" }] },
  { name: "Slovenčina", englishName: "slovak", iso: "sk", dialects: [{ code: "sk-SK", region: "Slovakia" }] },
  { name: "Slovenščina", englishName: "slovenian", iso: "sl", dialects: [{ code: "sl-SI", region: "Slovenia" }] },
  { name: "Suomi", englishName: "finnish", iso: "fi", dialects: [{ code: "fi-FI", region: "Finland" }] },
  { name: "Svenska", englishName: "swedish", iso: "sv", dialects: [{ code: "sv-SE", region: "Sweden" }] },
  { name: "ไทย", englishName: "thai", iso: "th", dialects: [{ code: "th-TH", region: "Thailand" }] },
  { name: "Türkçe", englishName: "turkish", iso: "tr", dialects: [{ code: "tr-TR", region: "Türkiye" }] },
  { name: "Українська", englishName: "ukrainian", iso: "uk", dialects: [{ code: "uk-UA", region: "Ukraine" }] },
  { name: "Tiếng Việt", englishName: "vietnamese", iso: "vi", dialects: [{ code: "vi-VN", region: "Vietnam" }] },
  { name: "中文", englishName: "chinese mandarin", iso: "cmn", dialects: [{ code: "cmn-Hans-CN", region: "普通话 (中国大陆)" }, { code: "cmn-Hant-TW", region: "中文 (台灣)" }, { code: "yue-Hant-HK", region: "粵語 (香港)" }] },
  { name: "Ελληνικά", englishName: "greek", iso: "el", dialects: [{ code: "el-GR", region: "Greece" }] },
  { name: "العربية", englishName: "arabic", iso: "ar", dialects: [{ code: "ar-SA", region: "المملكة العربية السعودية" }, { code: "ar-EG", region: "مصر" }, { code: "ar-AE", region: "الإمارات" }] },
  { name: "हिन्दी", englishName: "hindi", iso: "hi", dialects: [{ code: "hi-IN", region: "India" }] },
];

const aliases: Readonly<Record<string, string>> = { zh: "cmn", no: "nb", nn: "nb" };

export function toSpeechTag(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  for (const language of WEB_SPEECH_LANGUAGES) {
    if (language.dialects.some((dialect) => dialect.code.toLowerCase() === normalized)) return value.trim();
    if (language.iso === (aliases[normalized] ?? normalized)) return language.dialects[0]?.code;
  }
  return undefined;
}

export function resolveSpeechLanguage(): string {
  if (typeof navigator === "undefined") return "en-US";
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const tag = toSpeechTag(candidate);
    if (tag) return tag;
  }
  return toSpeechTag(navigator.language) ?? "en-US";
}

export type SpeechLanguageRow = { readonly tag: string; readonly name: string; readonly region: string; readonly search: string };

export const SPEECH_LANGUAGE_ROWS: readonly SpeechLanguageRow[] = WEB_SPEECH_LANGUAGES.flatMap((language) =>
  language.dialects.map((dialect) => ({
    tag: dialect.code,
    name: language.name,
    region: dialect.region,
    search: `${language.name} ${language.englishName} ${language.iso} ${dialect.code} ${dialect.region}`.toLocaleLowerCase(),
  })),
);
