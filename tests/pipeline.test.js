// SPDX-License-Identifier: GPL-2.0-or-later
//
// Headless tests for extension/lib/pipeline.js. No GNOME Shell needed.
//
//   gjs -m tests/pipeline.test.js        (or: make test)
//
// Needs zbarimg and tesseract (with English data) on $PATH.
// Exit code 0 = all passed. Fixtures are made by tests/fixtures/generate.py.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import * as P from '../extension/lib/pipeline.js';

const HERE = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const fixture = name => GLib.build_filenamev([HERE, 'fixtures', name]);

// Keep in sync with tests/fixtures/generate.py.
const QR = 'https://example.com/screenshot-scan?id=42';
const EAN13 = '4006381333931';
const CODE128 = 'SCAN-128-TEST';
const TEXT_LINES = [
    'Screenshot Scan reads text locally.',
    'Order number 58213 ships on Friday.',
    'Contact: matti.meikalainen@example.com',
];

let passed = 0;
const failures = [];

/**
 * @param {string} name
 * @param {Function} fn may be async
 */
async function test(name, fn) {
    try {
        await fn();
        passed++;
        print(`ok   ${name}`);
    } catch (e) {
        failures.push(name);
        print(`FAIL ${name}\n     ${e.message.replace(/\n/g, '\n     ')}`);
    }
}

function eq(actual, expected, what = 'value') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`${what}:\n  expected ${e}\n  actual   ${a}`);
}

function ok(cond, msg) {
    if (!cond)
        throw new Error(msg);
}

/** OCR may differ by tesseract version, so compare line-by-line content. */
function hasLines(text, lines) {
    const got = text.split('\n');
    for (const line of lines)
        ok(got.includes(line), `missing OCR line ${JSON.stringify(line)} in:\n${text}`);
}

async function main() {
    // ---- pure helpers -------------------------------------------------
    await test('cleanOcrText trims, drops \\f and collapses blank lines', () => {
        eq(P.cleanOcrText('  \nHello  \n\n\n\nWorld\t\n\f'), 'Hello\n\nWorld');
        eq(P.cleanOcrText('\f\n  \n'), '');
        eq(P.cleanOcrText('a\r\nb'), 'a\nb');
    });

    await test('parseZbarOutput gives one payload per line', () => {
        eq(P.parseZbarOutput('one\ntwo  \n\n'), ['one', 'two']);
        eq(P.parseZbarOutput(''), []);
    });

    await test('parseLanguages validates and defaults to eng', () => {
        eq(P.parseLanguages('eng+fin'), ['eng', 'fin']);
        eq(P.parseLanguages(' eng, swe  eng '), ['eng', 'swe']);
        eq(P.parseLanguages(''), ['eng']);
        // argv is never passed through a shell, but junk tokens are still dropped
        eq(P.parseLanguages('eng;rm -rf'), ['eng']);
        eq(P.parseLanguages('eng+fin;x'), ['eng']);
        eq(P.parseLanguages('$(x)'), ['eng']);
    });

    await test('formatResult follows each mode', () => {
        const codes = ['A', 'B'];
        eq(P.formatResult(codes, 'text', 'auto'), 'A\nB');
        eq(P.formatResult([], 'text', 'auto'), 'text');
        eq(P.formatResult(codes, 'text', 'codes'), 'A\nB');
        eq(P.formatResult(codes, 'text', 'text'), 'text');
        eq(P.formatResult(codes, 'text', 'both'), 'A\nB\n\ntext');
        eq(P.formatResult([], 'text', 'both'), 'text');
        eq(P.formatResult([], '', 'both'), '');
        eq(P.formatResult(codes, '', 'bogus'), 'A\nB');
    });

    await test('countLines ignores blank lines', () => {
        eq(P.countLines(''), 0);
        eq(P.countLines('a\n\nb\nc'), 3);
    });

    await test('langpackFor names the Fedora package', () => {
        eq(P.langpackFor('fin'), 'tesseract-langpack-fin');
    });

    // ---- environment --------------------------------------------------
    await test('zbarimg and tesseract are installed', () => {
        eq(P.findMissingTools(), [], 'missing tools (install: sudo dnf install zbar tesseract tesseract-langpack-eng)');
    });

    await test('findMissingPackages reports an uninstalled language', async () => {
        const missing = await P.findMissingPackages(['eng', 'zzz']);
        eq(missing, ['tesseract-langpack-zzz']);
    });

    // ---- fixtures, default (auto) mode ----------------------------------
    const scan = (name, mode) => P.scanImage(fixture(name), {mode, languages: ['eng']});

    await test('auto: QR code', async () => {
        const r = await scan('qr.png', 'auto');
        eq(r.result, QR);
        eq(r.text, '', 'tesseract must not run when codes were found');
    });

    await test('auto: EAN-13 barcode', async () => {
        eq((await scan('ean13.png', 'auto')).result, EAN13);
    });

    await test('auto: Code128 barcode', async () => {
        eq((await scan('code128.png', 'auto')).result, CODE128);
    });

    await test('auto: plain text falls back to OCR', async () => {
        const r = await scan('text.png', 'auto');
        eq(r.codes, []);
        hasLines(r.result, TEXT_LINES);
    });

    await test('auto: light text on dark background', async () => {
        hasLines((await scan('text-dark.png', 'auto')).result, TEXT_LINES);
    });

    await test('auto: blank image gives empty result', async () => {
        const r = await scan('blank.png', 'auto');
        eq(r.result, '');
        eq(P.countLines(r.result), 0);
    });

    await test('auto: mixed image prefers codes', async () => {
        eq((await scan('mixed.png', 'auto')).result, `${QR}\n${EAN13}`);
    });

    // ---- other modes ---------------------------------------------------
    await test('codes: text-only image gives empty result', async () => {
        eq((await scan('text.png', 'codes')).result, '');
    });

    await test('text: mixed image gives only OCR text', async () => {
        const r = await scan('mixed.png', 'text');
        eq(r.codes, [], 'zbar must not run in text mode');
        hasLines(r.result, TEXT_LINES.slice(0, 2));
    });

    await test('both: mixed image gives codes, blank line, text', async () => {
        const r = await scan('mixed.png', 'both');
        ok(r.result.startsWith(`${QR}\n${EAN13}\n\n`), `bad prefix:\n${r.result}`);
        hasLines(r.result, TEXT_LINES.slice(0, 2));
    });

    await test('missing image is an error, not a silent empty result', async () => {
        let threw = false;
        try {
            await scan('does-not-exist.png', 'auto');
        } catch {
            threw = true;
        }
        ok(threw, 'expected an error');
    });

    await test('cancelling runCommand kills the process', async () => {
        const cancellable = new Gio.Cancellable();
        const marker = `screenshot-scan-cancel-${GLib.random_int()}`;
        const started = Date.now();
        const run = P.runCommand(['sh', '-c', `exec -a ${marker} sleep 30`], cancellable);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        try {
            await run;
        } catch {}
        ok(Date.now() - started < 5000, 'runCommand did not return soon after cancel');
        const [, out] = GLib.spawn_command_line_sync(`pgrep -f ${marker}`);
        eq(new TextDecoder().decode(out).trim(), '', 'process still running');
    });
}

const loop = new GLib.MainLoop(null, false);
let exitCode = 1;
main().then(() => {
    print(`\n${passed} passed, ${failures.length} failed`);
    exitCode = failures.length === 0 ? 0 : 1;
}).catch(e => {
    printerr(e);
}).finally(() => loop.quit());
loop.run();
System.exit(exitCode);
