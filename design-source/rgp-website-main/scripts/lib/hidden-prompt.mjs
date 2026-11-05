/**
 * hidden-prompt.mjs — read pasted secrets in a terminal without echoing them (`npm run search:connect`).
 *
 * Why not readline: the old search:setup prompt built one readline interface per question and muted it by
 * patching `_writeToOutput`. A paste then lost its tail between interfaces, part of it was echoed, and the
 * rest reached the shell as commands after the script exited (the secret ended up in shell history).
 *
 * Here ONE raw-mode reader is kept for the whole session:
 *   - bytes are split into lines as they arrive, so a paste delivered in many chunks is one answer;
 *   - Enter is \r in raw mode; \r\n, \n and bracketed-paste markers (ESC[200~ … ESC[201~) are handled,
 *     including a \r\n split across two chunks;
 *   - nothing typed or pasted is ever written to the output — only the question and a newline;
 *   - drain() swallows whatever is still buffered or still arriving, so nothing is left for the shell.
 * Ctrl-C / Ctrl-D / end of input cancel (Cancelled).
 */
import { StringDecoder } from 'node:string_decoder';

export class Cancelled extends Error {
  constructor() { super('cancelled'); this.name = 'Cancelled'; }
}

/** Pure line splitter: push(text) → { cancel }; lines are taken with shift(). */
export function createLineBuffer() {
  let partial = '';
  let lines = [];
  let skipLF = false;   // the \n of a \r\n (possibly in the next chunk)
  let esc = null;       // null | 'start' | 'csi' — inside an escape sequence (arrow keys, paste markers)
  let cancel = false;
  return {
    push(text) {
      for (const ch of text) {
        const c = ch.codePointAt(0);
        if (esc === 'start') { esc = ch === '[' ? 'csi' : null; continue; }
        if (esc === 'csi') { if (c >= 0x40 && c <= 0x7e) esc = null; continue; }
        if (ch === '\n' && skipLF) { skipLF = false; continue; }
        skipLF = false;
        if (ch === '\x1b') esc = 'start';
        else if (ch === '\x03' || ch === '\x04') cancel = true;   // Ctrl-C, Ctrl-D
        else if (ch === '\r' || ch === '\n') { lines.push(partial); partial = ''; skipLF = ch === '\r'; }
        else if (ch === '\x7f' || ch === '\b') partial = [...partial].slice(0, -1).join('');
        else if (ch === '\x15') partial = '';                    // Ctrl-U
        else if (c >= 0x20) partial += ch;                        // other control characters are dropped
      }
      return { cancel };
    },
    shift: () => lines.shift(),
    /** Forget everything buffered (complete lines and the unfinished one); keeps the \r\n state. */
    clear() { lines = []; partial = ''; esc = null; },
    get pending() { return lines.length + (partial ? 1 : 0); },
    get cancelled() { return cancel; },
  };
}

export class HiddenInput {
  /** @param {{ input?: NodeJS.ReadStream, output?: NodeJS.WriteStream, quietMs?: number, maxDrainMs?: number }} o */
  constructor({ input = process.stdin, output = process.stdout, quietMs = 250, maxDrainMs = 3000 } = {}) {
    Object.assign(this, { input, output, quietMs, maxDrainMs });
    this.buf = createLineBuffer();
    this.decoder = new StringDecoder('utf8');
    this.lastData = 0;
    this.ended = false;
    this.waiter = null;
    this.onData = (chunk) => {
      this.lastData = Date.now();
      this.buf.push(typeof chunk === 'string' ? chunk : this.decoder.write(chunk));
      this.wake();
    };
    this.onEnd = () => { this.ended = true; this.wake(); };
  }

  wake() { const w = this.waiter; this.waiter = null; w?.(); }

  start() {
    if (this.input.isTTY && typeof this.input.setRawMode === 'function') this.input.setRawMode(true);
    this.input.on('data', this.onData);
    this.input.on('end', this.onEnd);
    this.input.resume();
    return this;
  }

  /** Ask one question; resolves with the trimmed answer. Never echoes. */
  ask(question) {
    this.buf.clear();   // each question takes only what is entered after it is shown
    this.output.write(question);
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.buf.cancelled) { this.output.write('\n'); reject(new Cancelled()); return; }
        const line = this.buf.shift();
        if (line !== undefined) { this.output.write('\n'); resolve(line.trim()); return; }
        if (this.ended) { this.output.write('\n'); reject(new Cancelled()); return; }
        this.waiter = check;
      };
      check();
    });
  }

  /** Discard everything buffered, then keep discarding until no input has arrived for quietMs. */
  async drain() {
    const started = Date.now();
    this.buf.clear();
    while (!this.ended && Date.now() - this.lastData < this.quietMs && Date.now() - started < this.maxDrainMs) {
      await new Promise((r) => setTimeout(r, Math.min(50, this.quietMs)));
      this.buf.clear();
    }
    this.buf.clear();
  }

  stop() {
    this.input.off('data', this.onData);
    this.input.off('end', this.onEnd);
    if (this.input.isTTY && typeof this.input.setRawMode === 'function') this.input.setRawMode(false);
    this.input.pause();
  }
}

/**
 * Ask until validate() returns null (at most `tries` times). A rejected answer is never shown; whatever is
 * left of that paste is drained before asking again. optional: an empty answer returns ''.
 */
export async function askValid(io, question, validate, { tries = 3, optional = false } = {}) {
  for (let i = 1; i <= tries; i++) {
    const value = await io.ask(question);
    if (optional && value === '') return '';
    const problem = validate(value);
    if (!problem) return value;
    await io.drain();
    io.output.write(`  ✗ ${problem}. Nothing was saved${i < tries ? ' — copy it again and paste' : ''}.\n`);
  }
  throw new Error(`no valid value after ${tries} tries`);
}

const shape = (v) => `got ${v.length} character${v.length === 1 ? '' : 's'}${/\s/.test(v) ? ', with spaces in it' : ''}`;
export const checkClientId = (v) => (/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v) ? null
  : `that is not a Google OAuth client ID (it looks like 1234…-abc….apps.googleusercontent.com; ${shape(v)})`);
export const checkClientSecret = (v) => (/^GOCSPX-[A-Za-z0-9_-]{20,}$/.test(v) ? null
  : `that is not a Google OAuth client secret (it starts with GOCSPX- and is about 35 characters; ${shape(v)})`);
export const checkBingKey = (v) => (/^[A-Za-z0-9]{24,64}$/.test(v) ? null
  : `that is not a Bing Webmaster API key (32 letters and digits; ${shape(v)})`);
