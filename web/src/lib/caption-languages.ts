import { PARAKEET_LANGUAGES } from "@/lib/clips/languages";

/*
 * The languages with a captions page of their own (/auto-captions/<slug>): what people search
 * for by language ("Hindi caption generator", "Spanish subtitles for Reels"). Each page says
 * what's particular about captions in that language, from how Bamio really transcribes it:
 * which model (punctuation or not: PARAKEET_LANGUAGES decides), which script and font, how a
 * mix with English comes out. Only languages checked on real speech (scripts/lang-eval.mjs)
 * belong here. `own` is a few lines in the language itself, for people searching in it; it
 * says the app is in English, so nobody is surprised.
 */

export type CaptionLanguage = {
  /** The page's address: /auto-captions/<slug>. */
  slug: string;
  /** The language code the app uses. */
  code: string;
  name: string;
  /** The language's name in itself. */
  native: string;
  /** How its writing is named in a sentence ("Devanagari", "Arabic script"), and the font captions are drawn in. */
  script: string;
  font: string;
  /** A caption as Bamio writes it, word by word ("Let's start today's video"). */
  sample: string[];
  /** What a mix with English is called, where it has a name. */
  mix?: string;
  /** Written right to left. */
  rtl?: boolean;
  /** Written without spaces between words. */
  unspaced?: boolean;
  /** In the language itself: a headline and two sentences on what Bamio does. */
  own: { headline: string; text: string };
};

export const CAPTION_LANGUAGES: CaptionLanguage[] = [
  {
    slug: "spanish",
    code: "es",
    name: "Spanish",
    native: "Español",
    script: "Latin letters",
    font: "Bricolage Grotesque",
    sample: ["Empecemos", "el", "video", "de", "hoy."],
    mix: "Spanglish",
    own: {
      headline: "Subtítulos automáticos en español",
      text: "Pega un enlace o sube un archivo: Bamio transcribe el audio en español, sincroniza cada palabra y exporta el vídeo vertical con los subtítulos incrustados. La aplicación está en inglés.",
    },
  },
  {
    slug: "portuguese",
    code: "pt",
    name: "Portuguese",
    native: "Português",
    script: "Latin letters",
    font: "Bricolage Grotesque",
    sample: ["Vamos", "começar", "o", "vídeo", "de", "hoje."],
    own: {
      headline: "Legendas automáticas em português",
      text: "Cole um link ou envie um arquivo: o Bamio transcreve o áudio em português, sincroniza cada palavra e exporta o vídeo vertical com as legendas embutidas. O aplicativo está em inglês.",
    },
  },
  {
    slug: "french",
    code: "fr",
    name: "French",
    native: "Français",
    script: "Latin letters",
    font: "Bricolage Grotesque",
    sample: ["On", "commence", "la", "vidéo", "du", "jour."],
    mix: "Franglais",
    own: {
      headline: "Sous-titres automatiques en français",
      text: "Collez un lien ou importez un fichier : Bamio transcrit l’audio en français, synchronise chaque mot et exporte la vidéo verticale avec les sous-titres incrustés. L’application est en anglais.",
    },
  },
  {
    slug: "german",
    code: "de",
    name: "German",
    native: "Deutsch",
    script: "Latin letters",
    font: "Bricolage Grotesque",
    sample: ["Fangen", "wir", "mit", "dem", "Video", "an."],
    mix: "Denglisch",
    own: {
      headline: "Automatische Untertitel auf Deutsch",
      text: "Link einfügen oder Datei hochladen: Bamio transkribiert den deutschen Ton, synchronisiert jedes Wort und exportiert das Hochkant-Video mit eingebrannten Untertiteln. Die App ist auf Englisch.",
    },
  },
  {
    slug: "italian",
    code: "it",
    name: "Italian",
    native: "Italiano",
    script: "Latin letters",
    font: "Bricolage Grotesque",
    sample: ["Iniziamo", "il", "video", "di", "oggi."],
    own: {
      headline: "Sottotitoli automatici in italiano",
      text: "Incolla un link o carica un file: Bamio trascrive l’audio in italiano, sincronizza ogni parola ed esporta il video verticale con i sottotitoli impressi. L’app è in inglese.",
    },
  },
  {
    slug: "russian",
    code: "ru",
    name: "Russian",
    native: "Русский",
    script: "Cyrillic",
    font: "Noto Sans",
    sample: ["Начинаем", "сегодняшнее", "видео."],
    own: {
      headline: "Автоматические субтитры на русском",
      text: "Вставьте ссылку или загрузите файл: Bamio расшифрует русскую речь, синхронизирует каждое слово и экспортирует вертикальное видео со встроенными субтитрами. Интерфейс приложения на английском.",
    },
  },
  {
    slug: "hindi",
    code: "hi",
    name: "Hindi",
    native: "हिन्दी",
    script: "Devanagari",
    font: "Noto Sans Devanagari",
    sample: ["चलिए", "आज", "का", "वीडियो", "शुरू", "करते", "हैं"],
    mix: "Hinglish",
    own: {
      headline: "हिंदी में ऑटोमैटिक कैप्शन",
      text: "लिंक पेस्ट करें या फ़ाइल अपलोड करें: Bamio हिंदी ऑडियो को टेक्स्ट में बदलता है, हर शब्द को सही समय पर दिखाता है और कैप्शन के साथ वर्टिकल वीडियो एक्सपोर्ट करता है। ऐप अंग्रेज़ी में है।",
    },
  },
  {
    slug: "nepali",
    code: "ne",
    name: "Nepali",
    native: "नेपाली",
    script: "Devanagari",
    font: "Noto Sans Devanagari",
    sample: ["आजको", "भिडियो", "सुरु", "गरौं"],
    own: {
      headline: "नेपालीमा स्वचालित क्याप्सन",
      text: "लिङ्क पेस्ट गर्नुहोस् वा फाइल अपलोड गर्नुहोस्: Bamio ले नेपाली आवाजलाई पाठमा बदल्छ, हरेक शब्दको समय मिलाउँछ र क्याप्सनसहितको ठाडो भिडियो निर्यात गर्छ। एप अङ्ग्रेजीमा छ।",
    },
  },
  {
    slug: "arabic",
    code: "ar",
    name: "Arabic",
    native: "العربية",
    script: "Arabic script",
    font: "Noto Sans Arabic",
    sample: ["لنبدأ", "فيديو", "اليوم"],
    rtl: true,
    own: {
      headline: "ترجمة تلقائية للفيديو باللغة العربية",
      text: "الصق رابطًا أو ارفع ملفًا: يحوّل Bamio الكلام العربي إلى نص، ويضبط توقيت كل كلمة، ثم يصدّر فيديو عموديًا والنص مدمج فيه. واجهة التطبيق باللغة الإنجليزية.",
    },
  },
  {
    slug: "japanese",
    code: "ja",
    name: "Japanese",
    native: "日本語",
    script: "kanji and kana",
    font: "Noto Sans JP",
    sample: ["今日の", "動画を", "始めましょう"],
    unspaced: true,
    own: {
      headline: "日本語の自動字幕",
      text: "リンクを貼るか、ファイルをアップロードするだけ。Bamioが日本語の音声を文字に起こし、単語ごとにタイミングを合わせて、字幕を焼き込んだ縦型動画を書き出します。アプリの表示は英語です。",
    },
  },
  {
    slug: "korean",
    code: "ko",
    name: "Korean",
    native: "한국어",
    script: "Hangul",
    font: "Noto Sans KR",
    sample: ["오늘", "영상", "시작해", "볼게요"],
    own: {
      headline: "한국어 자동 자막",
      text: "링크를 붙여 넣거나 파일을 올리세요. Bamio가 한국어 음성을 받아쓰고 단어마다 타이밍을 맞춘 뒤, 자막이 들어간 세로 영상으로 내보냅니다. 앱 화면은 영어로 되어 있습니다.",
    },
  },
  {
    slug: "chinese",
    code: "zh",
    name: "Chinese",
    native: "中文",
    script: "Chinese characters",
    font: "Noto Sans SC",
    sample: ["我们", "开始", "今天的", "视频", "吧"],
    unspaced: true,
    own: {
      headline: "中文自动字幕",
      text: "粘贴链接或上传文件：Bamio 会转写中文语音，为每个词对齐时间，并导出带内嵌字幕的竖屏视频。应用界面为英文。",
    },
  },
  {
    slug: "indonesian",
    code: "id",
    name: "Indonesian",
    native: "Bahasa Indonesia",
    script: "Latin letters",
    font: "Bricolage Grotesque",
    sample: ["ayo", "kita", "mulai", "video", "hari", "ini"],
    own: {
      headline: "Subtitle otomatis bahasa Indonesia",
      text: "Tempel tautan atau unggah file: Bamio mentranskripsikan audio bahasa Indonesia, menyelaraskan setiap kata, lalu mengekspor video vertikal dengan subtitle yang menyatu. Aplikasinya berbahasa Inggris.",
    },
  },
  {
    slug: "turkish",
    code: "tr",
    name: "Turkish",
    native: "Türkçe",
    script: "Latin letters",
    font: "Bricolage Grotesque",
    sample: ["bugünkü", "videoya", "başlayalım"],
    own: {
      headline: "Türkçe otomatik altyazı",
      text: "Bir bağlantı yapıştırın veya dosya yükleyin: Bamio Türkçe konuşmayı yazıya döker, her kelimeyi zamanlar ve altyazıları gömülü dikey videoyu dışa aktarır. Uygulama İngilizcedir.",
    },
  },
  {
    slug: "vietnamese",
    code: "vi",
    name: "Vietnamese",
    native: "Tiếng Việt",
    script: "Latin letters with tone marks",
    font: "Bricolage Grotesque",
    sample: ["hãy", "bắt", "đầu", "video", "hôm", "nay"],
    own: {
      headline: "Phụ đề tự động tiếng Việt",
      text: "Dán liên kết hoặc tải tệp lên: Bamio chép lời tiếng Việt, căn thời gian cho từng từ và xuất video dọc có phụ đề gắn sẵn. Ứng dụng dùng tiếng Anh.",
    },
  },
];

export const captionLanguage = (slug: string) => CAPTION_LANGUAGES.find((l) => l.slug === slug);

/** Whether Bamio writes the language with punctuation and capitals (the European model does; the multilingual one doesn't). */
export const punctuated = (l: CaptionLanguage) => PARAKEET_LANGUAGES.has(l.code);

/** The search title and description of a language's captions page (the description at most 160 characters). */
export function captionLanguageMeta(l: CaptionLanguage) {
  return {
    path: `/auto-captions/${l.slug}`,
    title: `${l.name} caption generator: word-by-word ${l.name} subtitles`,
    description: `Add ${l.name} captions to TikToks, Shorts and Reels. Bamio transcribes ${l.name} speech, times every word and burns the captions into a 1080p video.`,
  };
}
