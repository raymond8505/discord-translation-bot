import type { TranslateResult, TranslationBackend } from "../backends/index.js";
import { libreLanguageCodes } from "./languages.fixture.js";

export interface TranslateCall {
  text: string;
  source: string;
  target: string;
}

export interface FakeBackend extends TranslationBackend {
  readonly translateCalls: TranslateCall[];
  languagesCalls: number;
}

export interface FakeBackendOptions {
  name?: string;
  languages?: () => Promise<string[]>;
  translate?: (text: string, source: string, target: string) => Promise<TranslateResult>;
}

/** Default translation: tags the text with the target so tests can see it round-trip. */
export async function echoTranslate(text: string, _source: string, target: string): Promise<TranslateResult> {
  return { text: `[${target}] ${text}`, detectedSource: "es" };
}

export function makeFakeBackend(options: FakeBackendOptions = {}): FakeBackend {
  const translateImpl = options.translate ?? echoTranslate;
  const languagesImpl = options.languages ?? (async () => [...libreLanguageCodes]);
  const translateCalls: TranslateCall[] = [];

  const backend: FakeBackend = {
    name: options.name ?? "fake",
    translateCalls,
    languagesCalls: 0,
    async translate(text, source, target) {
      translateCalls.push({ text, source, target });
      return translateImpl(text, source, target);
    },
    async languages() {
      backend.languagesCalls += 1;
      return languagesImpl();
    },
  };
  return backend;
}
