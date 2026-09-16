import {
  createScanner,
  parse,
  ParseErrorCode,
  printParseErrorCode,
  SyntaxKind,
  type ParseError,
} from "jsonc-parser";

export interface JsonPosition {
  line: number;
  column: number;
}

export interface JsonRange {
  start: JsonPosition;
  end: JsonPosition;
}

export interface JsonDiagnostic {
  code: string;
  message: string;
  offset: number;
  length: number;
  location: JsonRange;
  excerpt: string;
}

export interface JsonParseResult<T> {
  value?: T;
  diagnostics: JsonDiagnostic[];
  /** True when JSON.parse accepted the original document without extensions. */
  valid: boolean;
  /** True when the parser could reconstruct the document without discarding values. */
  recovered: boolean;
  /** True when an explicit fixer may rewrite the document as canonical JSON. */
  repairable: boolean;
}

const SAFE_RECOVERY_CODES = new Set<ParseErrorCode>([
  ParseErrorCode.CommaExpected,
  ParseErrorCode.CloseBraceExpected,
  ParseErrorCode.CloseBracketExpected,
  ParseErrorCode.EndOfFileExpected,
]);

const ERROR_MESSAGES: Partial<Record<ParseErrorCode, string>> = {
  [ParseErrorCode.InvalidSymbol]:
    "Unexpected symbol; JSON property names and string values must be quoted.",
  [ParseErrorCode.InvalidNumberFormat]: "Invalid number format.",
  [ParseErrorCode.PropertyNameExpected]: "Expected a quoted property name.",
  [ParseErrorCode.ValueExpected]: "Expected a JSON value.",
  [ParseErrorCode.ColonExpected]: "Expected ':' after the property name.",
  [ParseErrorCode.CommaExpected]: "Expected ',' between object properties or array items.",
  [ParseErrorCode.CloseBraceExpected]: "Expected '}' to close an object.",
  [ParseErrorCode.CloseBracketExpected]: "Expected ']' to close an array.",
  [ParseErrorCode.EndOfFileExpected]: "Unexpected content after the root JSON value.",
  [ParseErrorCode.InvalidCommentToken]: "Comments are not valid in strict JSON.",
  [ParseErrorCode.UnexpectedEndOfComment]: "Unterminated block comment.",
  [ParseErrorCode.UnexpectedEndOfString]: "Unterminated string literal.",
  [ParseErrorCode.UnexpectedEndOfNumber]: "Unterminated number literal.",
  [ParseErrorCode.InvalidUnicode]: "Invalid Unicode escape sequence.",
  [ParseErrorCode.InvalidEscapeCharacter]: "Invalid escape sequence in string literal.",
  [ParseErrorCode.InvalidCharacter]: "Invalid character in JSON input.",
};

function removeBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function positionAt(text: string, offset: number): JsonPosition {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  const prefix = text.slice(0, boundedOffset);
  const line = prefix.split("\n").length;
  const lastLineBreak = prefix.lastIndexOf("\n");
  return {
    line,
    column: boundedOffset - (lastLineBreak + 1) + 1,
  };
}

function excerptAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextBreak = text.indexOf("\n", offset);
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;
  return text.slice(lineStart, lineEnd).trimEnd();
}

function diagnosticFromParseError(text: string, error: ParseError): JsonDiagnostic {
  const end = error.offset + Math.max(error.length, 1);
  return {
    code: printParseErrorCode(error.error),
    message: ERROR_MESSAGES[error.error] ?? printParseErrorCode(error.error),
    offset: error.offset,
    length: error.length,
    location: {
      start: positionAt(text, error.offset),
      end: positionAt(text, end),
    },
    excerpt: excerptAt(text, error.offset),
  };
}

function diagnosticFromToken(
  text: string,
  code: "CommentNotAllowed" | "TrailingComma",
  offset: number,
  length: number,
): JsonDiagnostic {
  const end = offset + Math.max(length, 1);
  const message =
    code === "CommentNotAllowed"
      ? "Comments are not valid in strict JSON."
      : "Trailing commas are not valid in strict JSON.";
  return {
    code,
    message,
    offset,
    length,
    location: {
      start: positionAt(text, offset),
      end: positionAt(text, end),
    },
    excerpt: excerptAt(text, offset),
  };
}

/**
 * Identifies JSONC-only syntax through lexical tokens. This deliberately avoids
 * regular expressions so strings containing comment-like text remain untouched.
 */
function findStrictJsonExtensionDiagnostics(text: string): JsonDiagnostic[] {
  const scanner = createScanner(text, false);
  const diagnostics: JsonDiagnostic[] = [];
  let previousSignificantToken: SyntaxKind | undefined;
  let previousSignificantOffset = 0;
  let previousSignificantLength = 0;

  while (true) {
    const token = scanner.scan();
    if (token === SyntaxKind.EOF) break;

    const offset = scanner.getTokenOffset();
    const length = scanner.getTokenLength();
    if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) {
      diagnostics.push(diagnosticFromToken(text, "CommentNotAllowed", offset, length));
      continue;
    }
    if (token === SyntaxKind.Trivia || token === SyntaxKind.LineBreakTrivia) continue;

    if (
      (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) &&
      previousSignificantToken === SyntaxKind.CommaToken
    ) {
      diagnostics.push(
        diagnosticFromToken(
          text,
          "TrailingComma",
          previousSignificantOffset,
          previousSignificantLength,
        ),
      );
    }

    previousSignificantToken = token;
    previousSignificantOffset = offset;
    previousSignificantLength = length;
  }

  return diagnostics;
}

/**
 * Parses strict JSON first, then performs a fault-tolerant structural parse for
 * diagnostics and safe recovery. The returned value is intentionally withheld
 * for unsafe syntax so callers do not analyse a partially reconstructed object.
 */
export function parseJsonDocument<T>(input: string): JsonParseResult<T> {
  const text = removeBom(input);
  try {
    return {
      value: JSON.parse(text) as T,
      diagnostics: [],
      valid: true,
      recovered: false,
      repairable: false,
    };
  } catch {
    const parseErrors: ParseError[] = [];
    const tolerantValue = parse(text, parseErrors, {
      disallowComments: false,
      allowTrailingComma: true,
    }) as T;
    const parserDiagnostics = parseErrors.map((error) => diagnosticFromParseError(text, error));
    const extensionDiagnostics =
      parserDiagnostics.length === 0 ? findStrictJsonExtensionDiagnostics(text) : [];
    const diagnostics = parserDiagnostics.length > 0 ? parserDiagnostics : extensionDiagnostics;
    const repairable =
      diagnostics.length > 0 &&
      (parseErrors.length === 0 ||
        parseErrors.every((error) => SAFE_RECOVERY_CODES.has(error.error)));

    return {
      ...(repairable && { value: tolerantValue }),
      diagnostics,
      valid: false,
      recovered: repairable,
      repairable,
    };
  }
}

/** Returns canonical strict JSON only for documents proven safe to reconstruct. */
export function repairJsonDocument(input: string): string | undefined {
  const parsed = parseJsonDocument<unknown>(input);
  if (!parsed.repairable || parsed.value === undefined) return undefined;
  const repaired = JSON.stringify(parsed.value, null, 2) + "\n";
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return undefined;
  }
}

export function formatJsonDiagnostic(diagnostic: JsonDiagnostic): string {
  return `${diagnostic.message} (${diagnostic.code}) at ${diagnostic.location.start.line}:${diagnostic.location.start.column}`;
}
