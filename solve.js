// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly what csv-reader 1.0.0
// returns for {text, header} — {columns, rows, errors} — but faster.
//
// The reference reads one character at a time and builds every field by appending
// one character at a time. This version reads the same way, once left to right, but
// extracts each field with one slice() (a field is a slice of the text, or a few
// slices joined when a stray CR, a doubled quote or a CR inside quotes splits it),
// compares character codes instead of one-character strings, and returns each field
// as a plain string (the way it ended and how much the junk added are kept in two
// closure variables, so no result object is allocated per field). No regex, no
// splitting the text into lines, no per-character string building.
//
// Semantics (csv-reader 1.0.0's broken-row policy, exactly as the reference):
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header false), each padded with "" or
//     cut to the first record's width (short_row / long_row);
//   - each error is {code, line, row}, in the order met: line the 1-based line its
//     record starts on, row its record's index in rows (null for the header).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended (COMMA / LINE_BREAK / END) and, for an unquoted
  // read, how many characters it appended (for the quote_junk check).
  let fieldEnded = END;
  let fieldAdded = 0;

  // Join the segments of a field: `init` plus the text from segStart to endPos, plus any
  // earlier segments in `parts` (null when the field is a single slice).
  function finish(init, parts, segStart, endPos) {
    if (parts === null) return init + text.slice(segStart, endPos);
    parts.push(text.slice(segStart, endPos));
    return init + parts.join('');
  }

  // Reads unquoted characters onto `init` up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Returns the field's string; sets fieldEnded
  // and fieldAdded.
  function readUnquoted(init) {
    let parts = null;
    let segStart = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        // ','
        const value = finish(init, parts, segStart, pos);
        pos += 1;
        fieldEnded = COMMA;
        fieldAdded = value.length - init.length;
        return value;
      }
      if (c === 10) {
        // '\n'
        const value = finish(init, parts, segStart, pos);
        pos += 1;
        line += 1;
        fieldEnded = LINE_BREAK;
        fieldAdded = value.length - init.length;
        return value;
      }
      if (c === 13) {
        // '\r'
        if (pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
          const value = finish(init, parts, segStart, pos);
          pos += 2;
          line += 1;
          fieldEnded = LINE_BREAK;
          fieldAdded = value.length - init.length;
          return value;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) parts = [text.slice(segStart, pos)];
        else parts.push(text.slice(segStart, pos));
        pos += 1;
        segStart = pos;
        continue;
      }
      pos += 1;
    }
    const value = finish(init, parts, segStart, pos);
    fieldEnded = END;
    fieldAdded = value.length - init.length;
    return value;
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field's string; sets fieldEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let parts = null;
    let segStart = pos;
    let closed = false;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 34) {
        // '"'
        if (pos + 1 < len && text.charCodeAt(pos + 1) === 34) {
          if (parts === null) parts = [text.slice(segStart, pos)];
          else parts.push(text.slice(segStart, pos));
          parts.push('"');
          pos += 2;
          segStart = pos;
          continue;
        }
        pos += 1;
        closed = true;
        break;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (parts === null) parts = [text.slice(segStart, pos)];
        else parts.push(text.slice(segStart, pos));
        parts.push('\n');
        line += 1;
        pos += pos + 1 < len && text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        segStart = pos;
        continue;
      }
      if (c === 10) line += 1;
      pos += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is
      // read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    let value;
    if (parts === null) value = text.slice(segStart, pos - 1);
    else {
      parts.push(text.slice(segStart, pos - 1));
      value = parts.join('');
    }
    if (pos >= len) {
      fieldEnded = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fieldEnded = COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fieldEnded = LINE_BREAK;
      return value;
    }
    if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fieldEnded = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (fieldAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (fieldEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
