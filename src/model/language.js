const LANGUAGE_CODES = {
  ar: 'ar-SA', arabic: 'ar-SA', arabe: 'ar-SA',
  zh: 'zh-CN', chinese: 'zh-CN', mandarin: 'zh-CN', chines: 'zh-CN',
  de: 'de-DE', german: 'de-DE', deutsch: 'de-DE', alemao: 'de-DE',
  el: 'el-GR', greek: 'el-GR', grego: 'el-GR',
  en: 'en-US', english: 'en-US', ingles: 'en-US',
  es: 'es-ES', spanish: 'es-ES', espanol: 'es-ES', espanhol: 'es-ES',
  fr: 'fr-FR', french: 'fr-FR', francais: 'fr-FR', frances: 'fr-FR',
  it: 'it-IT', italian: 'it-IT', italiano: 'it-IT',
  ja: 'ja-JP', japanese: 'ja-JP', nihongo: 'ja-JP', japones: 'ja-JP',
  ko: 'ko-KR', korean: 'ko-KR', coreano: 'ko-KR',
  la: 'la', latin: 'la', latim: 'la',
  nl: 'nl-NL', dutch: 'nl-NL', holandes: 'nl-NL',
  pl: 'pl-PL', polish: 'pl-PL', polones: 'pl-PL',
  pt: 'pt-BR', portuguese: 'pt-BR', portugues: 'pt-BR',
  ru: 'ru-RU', russian: 'ru-RU', russo: 'ru-RU',
  sv: 'sv-SE', swedish: 'sv-SE', sueco: 'sv-SE',
  tr: 'tr-TR', turkish: 'tr-TR', turco: 'tr-TR',
};

function foldKey(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
}

/** Map a language name or ISO/BCP-47 tag into a speech-synthesis tag when possible. */
function speechLocale(language) {
  if (typeof language !== 'string' || !language.trim()) return '';
  const trimmed = language.trim();
  if (/^[a-z]{2,3}-[a-z0-9]{2,4}$/i.test(trimmed)) return trimmed;
  return LANGUAGE_CODES[foldKey(trimmed)] ?? trimmed;
}

/** Resolve target/native language settings from a Buch `_index.md` frontmatter. */
function bookLanguage(app, book) {
  const fm = book?.index ? app.metadataCache.getFileCache(book.index)?.frontmatter : null;
  const language = typeof fm?.language === 'string' && fm.language.trim() ? fm.language.trim() : '';
  const nativeLanguage = typeof fm?.native_language === 'string' && fm.native_language.trim()
    ? fm.native_language.trim()
    : typeof fm?.nativeLanguage === 'string' && fm.nativeLanguage.trim()
      ? fm.nativeLanguage.trim()
      : '';
  const mode = typeof fm?.mode === 'string' ? fm.mode.trim().toLowerCase() : '';
  return {
    language,
    nativeLanguage,
    speechLang: speechLocale(language),
    isLanguageBook: Boolean(language || mode === 'language'),
  };
}

/** Strip Obsidian links, clozes, embeds, and Markdown styling before speech synthesis. */
function stripSpeechMarkup(text) {
  return String(text ?? '')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/==([^=;]+?)(?:;;[^=]+?)?==/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_~#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Speak text using the runtime Web Speech API when available. */
function speakText(text, lang = '', rate = 1) {
  const clean = stripSpeechMarkup(text);
  if (!clean || typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    return false;
  }
  const utterance = new SpeechSynthesisUtterance(clean);
  if (lang) utterance.lang = lang;
  utterance.rate = Math.min(2, Math.max(0.5, Number(rate) || 1));
  window.speechSynthesis.cancel?.();
  window.speechSynthesis.speak(utterance);
  return true;
}

module.exports = { speechLocale, bookLanguage, stripSpeechMarkup, speakText };
