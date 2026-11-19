// SPDX-License-Identifier: GPL-2.0-or-later
//
// End-to-end harness. Runs INSIDE a throwaway headless GNOME Shell started
// by tests/e2e/run.sh, next to the real Screenshot Scan extension, and
// drives the real screenshot UI the way a user would:
//
//   show a fixture image on screen → open the UI → pick Scan → select
//   area / screen / window → press capture → read the clipboard.
//
// It also checks that no screenshot file is written, that temp files are
// cleaned up, that normal screenshots still work, and that disabling the
// extension removes every trace. Results go to $E2E_OUT/result.json, then
// the Shell exits.
//
// This pokes private ScreenshotUI members on purpose (to click and select);
// if it breaks on a new GNOME version, compare with js/ui/screenshot.js.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'screenshot-scan@awikman-bot.github.io';
const SENTINEL = '<<clipboard-sentinel>>';
const QR = 'https://example.com/screenshot-scan?id=42';
const EAN13 = '4006381333931';
const CODE128 = 'SCAN-128-TEST';
const TEXT_LINE = 'Order number 58213 ships on Friday.';

const env = name => GLib.getenv(name);
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));

function getClipboard() {
    return new Promise(resolve => {
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_c, text) => resolve(text));
    });
}

async function waitFor(pred, timeoutMs, what) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const v = await pred();
        if (v)
            return v;
        if (Date.now() > end)
            throw new Error(`timed out waiting for ${what}`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(100);
    }
}

function listDir(path, prefix = '') {
    const out = [];
    try {
        const iter = Gio.File.new_for_path(path).enumerate_children('standard::name', 0, null);
        let info;
        while ((info = iter.next_file(null)) !== null) {
            if (info.get_name().startsWith(prefix))
                out.push(info.get_name());
        }
    } catch {
        // missing dir = empty
    }
    return out;
}

// Disabling the extension under test makes GNOME disable and re-enable every
// extension enabled after it, including this harness. Run only once.
let started = false;

/** Every *.png under dir, recursively (to catch stray screenshot files). */
function findPngs(dir) {
    const out = [];
    for (const name of listDir(dir)) {
        const path = GLib.build_filenamev([dir, name]);
        if (GLib.file_test(path, GLib.FileTest.IS_DIR) && !GLib.file_test(path, GLib.FileTest.IS_SYMLINK))
            out.push(...findPngs(path));
        else if (name.endsWith('.png'))
            out.push(path);
    }
    return out;
}

export default class E2EHarness extends Extension {
    enable() {
        if (started)
            return;
        started = true;
        this._results = [];
        this._actors = [];
        // Run after the Shell (and the extension under test) finished starting.
        if (Main.layoutManager._startingUp)
            Main.layoutManager.connectObject('startup-complete', () => this._start(), this);
        else
            this._start();
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
    }

    _start() {
        this._run().catch(e => this._record('harness crashed', false, `${e}\n${e.stack}`))
            .finally(() => this._finish());
    }

    _record(name, ok, detail = '') {
        this._results.push({name, ok, detail});
        console.log(`E2E ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    }

    async _check(name, fn) {
        try {
            const detail = await fn();
            this._record(name, true, detail ?? '');
        } catch (e) {
            this._record(name, false, e.message);
        }
    }

    _finish() {
        const path = GLib.build_filenamev([env('E2E_OUT'), 'result.json']);
        Gio.File.new_for_path(path).replace_contents(
            JSON.stringify(this._results, null, 2), null, false, 0, null);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            global.context.terminate();
            return GLib.SOURCE_REMOVE;
        });
    }

    get _ui() {
        return Main.screenshotUI;
    }

    get _patch() {
        return Main.extensionManager.lookup(UUID)?.stateObj?._patch ?? null;
    }

    /** Puts a fixture PNG on screen at (x, y), 1:1, above everything. */
    async _showFixture(name, x = 100, y = 100) {
        this._clearFixtures();
        const path = GLib.build_filenamev([env('E2E_FIXTURES'), name]);
        const [, w, h] = GdkPixbuf.Pixbuf.get_file_info(path);
        const actor = new St.Widget({
            x, y, width: w, height: h,
            style: `background-image: url("file://${path}"); background-size: ${w}px ${h}px;`,
        });
        Main.layoutManager.uiGroup.add_child(actor);
        Main.layoutManager.uiGroup.set_child_above_sibling(actor, null);
        this._actors.push(actor);
        await sleep(400); // let the texture load and a frame paint
        return {x, y, w, h};
    }

    /** Saves the whole screen to $E2E_OUT/<name> for a human/agent to look at. */
    async _snapshot(name) {
        const file = Gio.File.new_for_path(GLib.build_filenamev([env('E2E_OUT'), name]));
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream); // promisified by screenshot.js
        stream.close(null);
    }

    _clearFixtures() {
        for (const a of this._actors)
            a.destroy();
        this._actors = [];
    }

    async _openWithScan() {
        await this._ui.open();
        await sleep(300);
        const button = this._patch?.button;
        if (!button)
            throw new Error('Scan button not found');
        button.checked = true; // what a click does (toggle_mode)
        if (!this._patch.scanActive)
            throw new Error('Scan did not become active');
        return button;
    }

    _selectArea({x, y, w, h}) {
        const sel = this._ui._areaSelector;
        this._ui._selectionButton.checked = true;
        sel._startX = x;
        sel._startY = y;
        sel._lastX = x + w - 1;
        sel._lastY = y + h - 1;
        sel._updateSelectionRect();
    }

    async _waitClosed() {
        await waitFor(() => !this._ui.visible, 3000, 'screenshot UI to close');
    }

    /** Capture with Scan on and return what lands on the clipboard. */
    async _scanAndRead(select) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, SENTINEL);
        await this._openWithScan();
        await select();
        await this._ui._onCaptureButtonClicked();
        await this._waitClosed();
        const text = await waitFor(async () => {
            const t = await getClipboard();
            return t !== SENTINEL ? t : null;
        }, 20000, 'clipboard to change').catch(() => SENTINEL);
        return text;
    }

    _lastNotificationTitle() {
        const src = Main.extensionManager.lookup(UUID)?.stateObj?._source;
        const n = src?.notifications?.at(-1);
        return n?.title ?? null;
    }

    async _run() {
        Main.overview.hide();
        if (env('E2E_SCENARIO') === 'missing-tools')
            await this._runMissingTools();
        else
            await this._runMain();
    }

    /** zbarimg and tesseract are hidden from $PATH by run.sh. */
    async _runMissingTools() {
        const src = () => Main.extensionManager.lookup(UUID)?.stateObj?._source;
        const missingTitle = 'Screenshot Scan needs more software';

        await this._check('startup notification names the missing packages', async () => {
            await waitFor(() => this._lastNotificationTitle() === missingTitle, 10000,
                'missing-software notification');
            const body = src().notifications.at(-1).body;
            if (!body.includes('sudo dnf install zbar tesseract'))
                throw new Error(`body = ${JSON.stringify(body)}`);
            return body.replace(/\n/g, ' ');
        });

        await this._check('scan with tools missing → notification, clipboard untouched', async () => {
            const before = src().notifications.length;
            const g = await this._showFixture('qr.png');
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, SENTINEL);
            await this._openWithScan();
            this._selectArea(g);
            await this._ui._onCaptureButtonClicked();
            await this._waitClosed();
            // Transient notifications replace each other, so count additions.
            await waitFor(() => src()?.notifications.length > before ||
                this._lastNotificationTitle() === missingTitle, 10000, 'notification');
            if (this._lastNotificationTitle() !== missingTitle)
                throw new Error(`last notification: ${this._lastNotificationTitle()}`);
            if (await getClipboard() !== SENTINEL)
                throw new Error('clipboard changed');
            if (listDir(GLib.get_user_runtime_dir(), 'screenshot-scan-').length)
                throw new Error('temp file left behind');
        });
        this._clearFixtures();
    }

    async _runMain() {
        const ui = this._ui;
        // Same lookup as _storeScreenshot() in js/ui/screenshot.js.
        const screenshotsDir = GLib.build_filenamev([
            GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || GLib.get_home_dir(),
            'Screenshots']);
        const runtimeDir = GLib.get_user_runtime_dir();

        await this._check('extension is ACTIVE', () => {
            const ext = Main.extensionManager.lookup(UUID);
            if (!ext)
                throw new Error('not found');
            if (ext.state !== ExtensionState.ACTIVE)
                throw new Error(`state ${ext.state}, error: ${ext.error}`);
            return `GNOME Shell ${Config.PACKAGE_VERSION}`;
        });

        await this._check('Scan button sits next to camera/video buttons', async () => {
            await ui.open();
            await sleep(300);
            const children = ui._shotCastContainer.get_children();
            if (!children.includes(this._patch.button))
                throw new Error('button not in _shotCastContainer');
            if (this._patch.scanActive)
                throw new Error('Scan must be off when the UI opens');
            ui.close(true);
            return `${children.length} buttons in row`;
        });

        await this._check('radio behaviour: Scan hides camera highlight, camera click turns Scan off', async () => {
            await this._openWithScan();
            if (!ui._shotButton.checked)
                throw new Error('_shotButton must stay checked underneath');
            if (ui._shotButton.has_style_pseudo_class('checked'))
                throw new Error('camera still highlighted');
            await sleep(300);
            await this._snapshot('screenshot-ui-scan-mode.png');
            ui._shotButton.emit('clicked', 1);
            if (this._patch.scanActive)
                throw new Error('Scan still active after camera click');
            if (!ui._shotButton.has_style_pseudo_class('checked'))
                throw new Error('camera highlight not restored');
            ui.close(true);
        });

        await this._check('Area + QR code → payload on clipboard', async () => {
            const g = await this._showFixture('qr.png');
            const got = await this._scanAndRead(() => this._selectArea(g));
            if (got !== QR)
                throw new Error(`clipboard = ${JSON.stringify(got)}`);
            return this._lastNotificationTitle();
        });

        await this._check('Area + EAN-13 → payload on clipboard', async () => {
            const g = await this._showFixture('ean13.png');
            const got = await this._scanAndRead(() => this._selectArea(g));
            if (got !== EAN13)
                throw new Error(`clipboard = ${JSON.stringify(got)}`);
        });

        await this._check('Area + Code128 → payload on clipboard', async () => {
            const g = await this._showFixture('code128.png');
            const got = await this._scanAndRead(() => this._selectArea(g));
            if (got !== CODE128)
                throw new Error(`clipboard = ${JSON.stringify(got)}`);
        });

        await this._check('Area + text → OCR text on clipboard', async () => {
            const g = await this._showFixture('text.png');
            const t0 = Date.now();
            const got = await this._scanAndRead(() => this._selectArea(g));
            const ms = Date.now() - t0;
            if (!got.split('\n').includes(TEXT_LINE))
                throw new Error(`clipboard = ${JSON.stringify(got)}`);
            return `${this._lastNotificationTitle()}, ${ms} ms incl. UI open/close`;
        });

        await this._check('Area + blank → clipboard untouched, "No text found"', async () => {
            const g = await this._showFixture('blank.png');
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, SENTINEL);
            await this._openWithScan();
            this._selectArea(g);
            await ui._onCaptureButtonClicked();
            await this._waitClosed();
            await waitFor(() => this._lastNotificationTitle() === 'No text found', 20000,
                '"No text found" notification');
            const got = await getClipboard();
            if (got !== SENTINEL)
                throw new Error(`clipboard changed to ${JSON.stringify(got)}`);
        });

        await this._check('Screen mode + QR on screen → payload', async () => {
            await this._showFixture('qr.png', 300, 200);
            const got = await this._scanAndRead(() => {
                ui._screenButton.checked = true;
            });
            if (got !== QR)
                throw new Error(`clipboard = ${JSON.stringify(got)}`);
        });

        await this._check('Window mode + window showing Code128 → payload', async () => {
            this._clearFixtures();
            const proc = Gio.Subprocess.new(['gjs', '-m', env('E2E_SHOW_IMAGE'),
                GLib.build_filenamev([env('E2E_FIXTURES'), 'code128.png']), 'e2e-window'],
            Gio.SubprocessFlags.NONE);
            try {
                await waitFor(() => global.get_window_actors()
                    .some(a => a.meta_window.get_title() === 'e2e-window'), 15000, 'test window');
                await sleep(800);
                const got = await this._scanAndRead(async () => {
                    ui._windowButton.checked = true;
                    const wins = ui._windowSelectors.flatMap(s => s.windows());
                    const win = wins.find(w => w.get_accessible_name?.() === 'e2e-window') ?? wins[0];
                    if (!win)
                        throw new Error('no window in selector');
                    win.checked = true;
                    await sleep(100);
                });
                if (got !== CODE128)
                    throw new Error(`clipboard = ${JSON.stringify(got)}`);
            } finally {
                proc.force_exit();
            }
        });

        await this._check('no screenshot file was saved by scans', () => {
            const files = findPngs(GLib.get_home_dir());
            if (files.length > 0)
                throw new Error(`found ${files.join(', ')}`);
            return `no PNG anywhere under ${GLib.get_home_dir()}`;
        });

        await this._check('temp files deleted from $XDG_RUNTIME_DIR', () => {
            const left = listDir(runtimeDir, 'screenshot-scan-');
            if (left.length > 0)
                throw new Error(`left behind: ${left.join(', ')}`);
            return runtimeDir;
        });

        await this._check('Scan off → native screenshot still saved as usual', async () => {
            const g = await this._showFixture('text.png');
            await ui.open();
            await sleep(300);
            this._selectArea(g);
            await ui._onCaptureButtonClicked();
            await this._waitClosed();
            await waitFor(() => listDir(screenshotsDir).length === 1, 5000, 'native screenshot file');
        });

        await this._check('portal screenshot (SCREENSHOT_ONLY) hides Scan', async () => {
            await ui.open(2);
            await sleep(300);
            const visible = this._patch.button.visible;
            ui.close(true);
            await sleep(100);
            await ui.open();
            await sleep(200);
            const visibleAgain = this._patch.button.visible;
            ui.close(true);
            if (visible || !visibleAgain)
                throw new Error(`visible in portal mode=${visible}, after=${visibleAgain}`);
        });

        await this._check('disable() removes every trace', async () => {
            const before = ui._shotCastContainer.get_n_children();
            Main.extensionManager.disableExtension(UUID);
            await sleep(300);
            const problems = [];
            if (ui._shotCastContainer.get_n_children() !== before - 1)
                problems.push('button still in container');
            if (Object.hasOwn(ui, '_onCaptureButtonClicked'))
                problems.push('_onCaptureButtonClicked override not removed');
            if (!ui._shotButton.has_style_pseudo_class('checked'))
                problems.push('camera highlight missing');
            if (problems.length)
                throw new Error(problems.join('; '));
        });

        await this._check('re-enable works and scans again', async () => {
            Main.extensionManager.enableExtension(UUID);
            await sleep(300);
            const g = await this._showFixture('qr.png');
            const got = await this._scanAndRead(() => this._selectArea(g));
            if (got !== QR)
                throw new Error(`clipboard = ${JSON.stringify(got)}`);
        });

        await this._check('prefs window opens', async () => {
            this._clearFixtures();
            const isPrefs = a => a.meta_window.get_wm_class()?.includes('Extensions') ||
                a.meta_window.get_title()?.includes('Screenshot Scan');
            Main.extensionManager.openExtensionPrefs(UUID, '', {});
            await waitFor(() => global.get_window_actors().some(isPrefs), 20000, 'prefs window');
            await sleep(2500); // let the async language list fill in
            await this._snapshot('prefs.png');
            const w = global.get_window_actors().find(isPrefs).meta_window;
            return `title "${w.get_title()}" — look at out/prefs.png`;
        });
    }
}
