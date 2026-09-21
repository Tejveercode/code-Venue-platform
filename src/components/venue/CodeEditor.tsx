import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { Minus, Moon, Plus, Sun } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * The exam's coding surface.
 *
 * A thin CodeMirror 6 host rather than a React editor wrapper library: the
 * component owns exactly one EditorView (created once, in a layout effect so
 * it paints before the browser does — no flash), and reconfigures it through
 * Compartments so theme / font-size / language / read-only changes never
 * rebuild the document, scroll position or undo history.
 *
 * Language grammars are code-split: the editor mounts immediately as plain
 * text and only the detected language's parser chunk is fetched. A Python exam
 * never downloads the C++ or TypeScript grammar.
 *
 * Nothing here talks to the server. The parent still owns the value and
 * receives every edit through onChange, so autosave, submission, timers and
 * violation reporting are all unchanged.
 */

export type EditorLanguage =
  | "plain"
  | "python"
  | "cpp"
  | "java"
  | "javascript"
  | "sql";

const LANGUAGE_LABELS: Record<EditorLanguage, string> = {
  plain: "Plain text",
  python: "Python",
  cpp: "C / C++",
  java: "Java",
  javascript: "JavaScript",
  sql: "SQL",
};

const languageCache = new Map<EditorLanguage, Extension>();

/**
 * Loads (and memoises) one language's grammar. Each branch is a dynamic
 * import, so Vite emits a separate chunk per language and the exam route only
 * pays for the grammar it actually needs.
 */
async function loadLanguage(id: EditorLanguage): Promise<Extension> {
  const cached = languageCache.get(id);
  if (cached) return cached;

  let extension: Extension = [];
  switch (id) {
    case "python":
      extension = (await import("@codemirror/lang-python")).python();
      break;
    case "cpp":
      extension = (await import("@codemirror/lang-cpp")).cpp();
      break;
    case "java":
      extension = (await import("@codemirror/lang-java")).java();
      break;
    case "javascript":
      extension = (await import("@codemirror/lang-javascript")).javascript({
        typescript: true,
        jsx: true,
      });
      break;
    case "sql":
      extension = (await import("@codemirror/lang-sql")).sql();
      break;
    default:
      extension = [];
      break;
  }

  languageCache.set(id, extension);
  return extension;
}

/**
 * Best-effort language detection from the exam's own text.
 *
 * The rooms table has no language column, so an exam's language can only be
 * inferred from what the examiner wrote (exam name + prompt). The patterns are
 * deliberately conservative — they only fire on an explicit mention of a
 * language — and the fallback is plain text, i.e. exactly what the previous
 * <textarea> gave us. Nothing is inferred from the student's code, persisted,
 * or sent anywhere.
 */
const LANGUAGE_HINTS: ReadonlyArray<readonly [EditorLanguage, RegExp]> = [
  ["python", /\bpython3?\b|\bpandas\b|\bnumpy\b|\bdjango\b|\bflask\b/i],
  [
    "cpp",
    /\bc\+\+\b|\bcpp\b|\bstd::\b|\b#include\b|\b(?:in|c)\s+program\b|\bin\s+c\b/i,
  ],
  ["java", /\bjava\b|\bjvm\b|\bspring\s+boot\b/i],
  [
    "javascript",
    /\bjavascript\b|\btypescript\b|\bnode(?:\.?js)\b|\breact\b|\bjsx?\b/i,
  ],
  [
    "sql",
    /\bsql\b|\bmysql\b|\bpostgres(?:ql)?\b|\bsqlite\b|\bSELECT\b[\s\S]{0,80}\bFROM\b/i,
  ],
];

function detectLanguage(hint: string): EditorLanguage {
  if (!hint) return "plain";
  for (const [id, pattern] of LANGUAGE_HINTS) {
    if (pattern.test(hint)) return id;
  }
  return "plain";
}

const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * Syntax palette stays inside the app's warm family (hues ~20-60) instead of a
 * cool IDE blue: keywords/strings/numbers still separate clearly, but the code
 * surface never introduces a second brand hue. Every colour here clears 4.5:1
 * on the #fffdf9 editor background.
 */
const warmLightHighlight = HighlightStyle.define([
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "#7d6d5f",
    fontStyle: "italic",
  },
  { tag: [t.docComment, t.meta], color: "#7d6d5f" },
  {
    tag: [t.keyword, t.moduleKeyword, t.definitionKeyword],
    color: "#8a4f2a",
    fontWeight: "600",
  },
  {
    tag: [t.controlKeyword, t.operatorKeyword],
    color: "#7a3b12",
    fontWeight: "600",
  },
  { tag: [t.modifier, t.self, t.constant(t.name)], color: "#a3521a" },
  { tag: [t.typeName, t.className, t.namespace, t.labelName], color: "#96601f" },
  {
    tag: [t.string, t.special(t.string), t.character, t.regexp],
    color: "#6b5a17",
  },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: "#9c4a1f" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "#a3521a",
  },
  { tag: [t.propertyName, t.attributeName], color: "#5a4636" },
  {
    tag: [
      t.variableName,
      t.name,
      t.local(t.variableName),
      t.definition(t.variableName),
    ],
    color: "#3d3128",
  },
  { tag: [t.operator, t.punctuation, t.separator], color: "#7a6a5c" },
  { tag: [t.bracket, t.squareBracket, t.brace, t.paren], color: "#7a6a5c" },
  { tag: [t.tagName, t.heading], color: "#8a4f2a", fontWeight: "700" },
  { tag: [t.link, t.escape], color: "#8a4f2a" },
  { tag: t.invalid, color: "#a13d2d" },
]);

/** Cream/caramel light editor — the exam default. */
const warmLightTheme: Extension = [
  EditorView.theme(
    {
      "&": { color: "#2c2420", backgroundColor: "#fffdf9" },
      ".cm-content": { caretColor: "#8a4f2a" },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "#8a4f2a",
        borderLeftWidth: "2px",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: "rgba(181, 115, 74, 0.26)" },
      ".cm-gutters": {
        backgroundColor: "#faf6f0",
        color: "#8d7c6d",
        borderRight: "1px solid rgba(60, 46, 36, 0.12)",
      },
      ".cm-activeLine": { backgroundColor: "rgba(181, 115, 74, 0.08)" },
      ".cm-activeLineGutter": {
        backgroundColor: "rgba(181, 115, 74, 0.14)",
        color: "#5a4c40",
      },
      ".cm-matchingBracket": {
        backgroundColor: "rgba(181, 115, 74, 0.28)",
        outline: "1px solid rgba(122, 59, 18, 0.45)",
      },
      ".cm-nonmatchingBracket": { color: "#a13d2d" },
      ".cm-selectionMatch": { backgroundColor: "rgba(181, 115, 74, 0.16)" },
      ".cm-searchMatch": {
        backgroundColor: "rgba(181, 115, 74, 0.3)",
        outline: "1px solid rgba(122, 59, 18, 0.4)",
      },
      ".cm-tooltip": {
        backgroundColor: "#fffdf9",
        border: "1px solid rgba(60, 46, 36, 0.16)",
        borderRadius: "10px",
      },
      ".cm-panels": { backgroundColor: "#faf6f0", color: "#2c2420" },
    },
    { dark: false },
  ),
  syntaxHighlighting(warmLightHighlight),
];

/**
 * Warm charcoal dark editor, layered over oneDark's syntax colours.
 *
 * Selectors carry `&.cm-editor` on purpose: every EditorView.theme compiles to
 * the same specificity, so a bare `&` here would tie with oneDark's rules and
 * lose the cascade — the dark surface would stay oneDark's cool blue-grey
 * instead of the app's warm charcoal.
 */
const warmDarkTheme: Extension = [
  oneDark,
  EditorView.theme(
    {
      "&.cm-editor": { backgroundColor: "#241f1b", color: "#efe6dc" },
      "&.cm-editor .cm-gutters": {
        backgroundColor: "#1e1a17",
        color: "#9a8b7c",
        borderRight: "1px solid rgba(255, 255, 255, 0.08)",
      },
      "&.cm-editor .cm-activeLine": {
        backgroundColor: "rgba(181, 115, 74, 0.14)",
      },
      "&.cm-editor .cm-activeLineGutter": {
        backgroundColor: "rgba(181, 115, 74, 0.2)",
        color: "#e0d3c6",
      },
      "&.cm-editor .cm-content": { caretColor: "#e0a06a" },
      "&.cm-editor .cm-cursor, &.cm-editor .cm-dropCursor": {
        borderLeftColor: "#e0a06a",
      },
      "&.cm-editor .cm-selectionBackground, &.cm-editor .cm-content ::selection":
        { backgroundColor: "rgba(181, 115, 74, 0.4)" },
      "&.cm-editor .cm-matchingBracket": {
        backgroundColor: "rgba(181, 115, 74, 0.35)",
        outline: "1px solid rgba(224, 160, 106, 0.5)",
      },
    },
    { dark: true },
  ),
];

/**
 * The editor fills its slot: the host is a positioned frame whose inner
 * wrapper is absolutely inset, so the editor's height is definite (a
 * percentage against a flex-sized parent would collapse) and long code scrolls
 * inside the editor instead of stretching the exam page.
 */
function sizingExtensions(fontSize: number): Extension {
  return EditorView.theme({
    "&": { height: "100%", fontSize: `${fontSize}px` },
    ".cm-scroller": { overflow: "auto", fontFamily: MONO, lineHeight: "1.65" },
    ".cm-content": { padding: "12px 0" },
    ".cm-line": { padding: "0 14px" },
  });
}

function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

const THEME_KEY = "cv:editor-theme";
const FONT_SIZE_KEY = "cv:editor-font-size";
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 20;

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function readStoredNumber(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
  } catch {
    return fallback;
  }
}

/** Students on phones get a slightly smaller default; the control overrides it. */
function defaultFontSize(): number {
  return typeof window !== "undefined" && window.innerWidth < 640 ? 13 : 14;
}

export type CodeEditorProps = {
  value: string;
  onChange: (next: string) => void;
  /** Detection-only reporting hooks — the events themselves are never blocked. */
  onPaste?: () => void;
  onCopy?: () => void;
  /** Fired when focus leaves the editor surface — used to flush a pending save. */
  onBlur?: () => void;  readOnly?: boolean;
  placeholder?: string;
  /** Explicit language. When omitted it is inferred from `languageHint`. */
  language?: EditorLanguage;
  /** Text used to infer the exam's language (typically exam name + prompt). */
  languageHint?: string;
  ariaLabel?: string;
};

export function CodeEditor({
  value,
  onChange,
  onPaste,
  onCopy,
  onBlur,
  readOnly = false,
  placeholder = "",
  language,
  languageHint,
  ariaLabel = "Code editor",
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const [fontSize, setFontSize] = useState(() =>
    readStoredNumber(
      FONT_SIZE_KEY,
      defaultFontSize(),
      MIN_FONT_SIZE,
      MAX_FONT_SIZE,
    ),
  );
  const [dark, setDark] = useState(() => readStoredBoolean(THEME_KEY, false));

  const activeLanguage = useMemo<EditorLanguage>(
    () => language ?? detectLanguage(languageHint ?? ""),
    [language, languageHint],
  );

  // Four independently reconfigurable slices of the editor's configuration.
  // Lazy stable value (not useRef().current, which reads a ref during
  // render — react-hooks/refs): created once, identity-stable for effects.
  const [compartments] = useState(() => ({
    language: new Compartment(),
    theme: new Compartment(),
    sizing: new Compartment(),
    readOnly: new Compartment(),
  }));

  // Read through refs so the view is built exactly once and never rebuilt for
  // a changing handler identity (the parent re-renders on every keystroke).
  const handlers = useRef({ onChange, onPaste, onCopy });
  // Synced after render (not during it — react-hooks/refs): the layout
  // effect runs before paint, so the view's update listeners always see
  // the latest handlers while the view itself is never rebuilt for a new
  // handler identity (the parent re-renders on every keystroke).
  useLayoutEffect(() => {
    handlers.current = { onChange, onPaste, onCopy };
  });

  // Transaction annotations (transaction.userEvent) already reported as
  // pastes. CodeMirror can apply one clipboard action as several
  // transactions in a single update — the set keeps the same annotation
  // object from being counted twice (each annotation object is unique per
  // dispatch). Cleared after every render; the transaction object identity
  // never outlives the update that contained it.
  const reportedPasteEvents = useRef(new Set<unknown>());
  // Flag set whenever a paste transaction was just reported, consumed by the
  // DOM paste handler's deferred check (see below) so the two detection
  // layers can never double-report the same physical paste.
  const pasteTxJustReported = useRef(false);
  useLayoutEffect(() => {
    reportedPasteEvents.current.clear();
  });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorState.tabSize.of(2),
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({
            spellcheck: "false",
            autocapitalize: "off",
            autocorrect: "off",
            "aria-label": ariaLabel,
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              handlers.current.onChange(update.state.doc.toString());
              // PASTE DETECTION — the editor integration layer. CodeMirror
              // annotates every paste transaction it applies with
              // userEvent "input.paste" (see doPaste in @codemirror/view),
              // which covers ALL editor-level paste paths: normal Ctrl+V,
              // paste with an empty clipboard, and IME/keyboard clipboard
              // inserts (notably on Android, where the EditContext path
              // applies pastes without a DOM paste event). Detecting here
              // instead of only on the DOM event closes the gap where a
              // legitimate paste never reached the violation reporter.
              //
              // The DOM-level paste handler below stays for non-transacting
              // clipboard scenarios (multi-paste; handlers that swallow the
              // event before CodeMirror converts it).
              if (update.transactions.length > 0) {
                for (const tr of update.transactions) {
                  if (tr.docChanged && tr.isUserEvent("input.paste") && !reportedPasteEvents.current.has(tr)) {
                    reportedPasteEvents.current.add(tr);
                    pasteTxJustReported.current = true;
                    handlers.current.onPaste?.();
                  }
                }
              }
            }
          }),
          EditorView.domEventHandlers({
            // The DOM paste event fires BEFORE CodeMirror's internal handler
            // converts the paste into an input.paste transaction, so calling
            // onPaste here would double-report every normal paste (the
            // updateListener reports the transaction too). Instead, defer the
            // DOM-level decision by a macrotask: if the transaction layer
            // already reported this paste (the flag is set synchronously
            // during the same event's dispatch), skip; only pastes that
            // produced NO transaction (event swallowed before conversion,
            // exotic paths) are reported from here. Net result: exactly one
            // violation report per physical paste, whichever layer saw it.
            paste: () => {
              setTimeout(() => {
                if (pasteTxJustReported.current) {
                  pasteTxJustReported.current = false;
                  return;
                }
                handlers.current.onPaste?.();
              }, 0);
              return false;
            },
            copy: () => {
              handlers.current.onCopy?.();
              return false;
            },
          }),
          placeholder ? placeholderExtension(placeholder) : [],
          // Starts as plain text; the grammar chunk is applied below as soon as
          // it arrives, so the surface is interactive immediately.
          compartments.language.of([]),
          compartments.theme.of(dark ? warmDarkTheme : warmLightTheme),
          compartments.sizing.of(sizingExtensions(fontSize)),
          compartments.readOnly.of(readOnlyExtensions(readOnly)),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally mount-only: later changes go through the compartments
    // below, which preserve document, selection and undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt external value changes (e.g. the autosaved draft restored from the
  // database). Echoes of the student's own typing are a no-op here, so this
  // never fights the editor for the cursor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.readOnly.reconfigure(readOnlyExtensions(readOnly)),
    });
  }, [readOnly, compartments]);

  useEffect(() => {
    let stale = false;
    void loadLanguage(activeLanguage)
      .then((extension) => {
        if (stale) return;
        viewRef.current?.dispatch({
          effects: compartments.language.reconfigure(extension),
        });
      })
      .catch(() => {
        // Grammar chunk failed to load: the editor keeps working as plain text.
      });
    return () => {
      stale = true;
    };
  }, [activeLanguage, compartments]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.theme.reconfigure(
        dark ? warmDarkTheme : warmLightTheme,
      ),
    });
    try {
      localStorage.setItem(THEME_KEY, dark ? "1" : "0");
    } catch {
      /* storage unavailable — the toggle still works for this session */
    }
  }, [dark, compartments]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.sizing.reconfigure(sizingExtensions(fontSize)),
    });
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
    } catch {
      /* storage unavailable — the control still works for this session */
    }
  }, [fontSize, compartments]);

  const lineCount = value ? value.split("\n").length : 0;

  return (
    <div className="cv-code-frame">
      <div
        className="cv-editor-toolbar"
        role="toolbar"
        aria-label="Editor settings"
      >
        <span className="cv-editor-lang">{LANGUAGE_LABELS[activeLanguage]}</span>
        <span className="cv-editor-counts">
          {lineCount} {lineCount === 1 ? "line" : "lines"} · {value.length} chars
        </span>
        <div className="cv-editor-tools">
          <button
            type="button"
            className="cv-editor-tool"
            onClick={() => setFontSize((s) => Math.max(MIN_FONT_SIZE, s - 1))}
            disabled={fontSize <= MIN_FONT_SIZE}
            aria-label="Decrease editor font size"
            title="Decrease font size"
          >
            <Minus size={13} />
          </button>
          <span className="cv-editor-size">{fontSize}px</span>
          <button
            type="button"
            className="cv-editor-tool"
            onClick={() => setFontSize((s) => Math.min(MAX_FONT_SIZE, s + 1))}
            disabled={fontSize >= MAX_FONT_SIZE}
            aria-label="Increase editor font size"
            title="Increase font size"
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="cv-editor-tool cv-editor-theme-toggle"
            onClick={() => setDark((d) => !d)}
            aria-pressed={dark}
            aria-label={
              dark ? "Switch editor to light theme" : "Switch editor to dark theme"
            }
            title={dark ? "Light editor theme" : "Dark editor theme"}
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>
      <div
        className={
          "cv-editor cv-code-editor" + (readOnly ? " cv-code-editor-locked" : "")
        }
        // React's onBlur is focusout-based, so it fires only when focus leaves
        // the editor entirely (the old <textarea>'s onBlur behaviour).
        onBlur={onBlur}
      >
        <div className="cv-code-editor-inner" ref={hostRef} />
      </div>
    </div>
  );
}

export default CodeEditor;
