// SPDX-License-Identifier: GPL-2.0-or-later
//
// Screenshot Scan: adds a "Scan" mode to GNOME's native screenshot UI that
// reads QR codes, barcodes and text from the captured area and copies the
// result to the clipboard. No file is saved and nothing leaves the machine.
//
// Wiring only; the work lives in:
//   lib/screenshotUiPatch.js  private screenshot-UI hooks (fragile part)
//   lib/pipeline.js           image file → text (zbarimg, tesseract)
//   lib/tempfile.js           private temp PNGs in $XDG_RUNTIME_DIR

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {Extension, gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Pipeline from './lib/pipeline.js';
import {ScanModePatch} from './lib/screenshotUiPatch.js';
import {deleteQuietly, purgeStaleTempFiles, writeTempPng} from './lib/tempfile.js';

const PREVIEW_MAX_CHARS = 200;

// Extensions are disabled on the lock screen and re-enabled on unlock.
// Remember across those cycles that the missing-dependency warning was
// shown, so it appears once per login instead of after every unlock.
let dependencyWarningShown = false;

export default class ScreenshotScanExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._gicon = Gio.icon_new_for_string(
            GLib.build_filenamev([this.path, 'icons', 'screenshot-scan-symbolic.svg']));

        purgeStaleTempFiles();

        this._patch = new ScanModePatch(Main.screenshotUI, {
            gicon: this._gicon,
            label: _('Scan Text and Codes'),
            onCapture: bytes => this._onCapture(bytes),
        });
        try {
            this._patch.enable();
        } catch (e) {
            this._patch.disable();
            this._patch = null;
            console.error(`${this.uuid}: cannot hook the screenshot UI: ${e.message}`);
            this._notify(_('Screenshot Scan does not support this GNOME version'),
                e.message, {force: true});
        }

        if (!dependencyWarningShown)
            this._warnAboutMissingPackages().catch(e => this._logUnlessCancelled(e));
    }

    disable() {
        this._cancellable?.cancel();
        this._cancellable = null;

        this._patch?.disable();
        this._patch = null;

        this._source?.destroy();
        this._source = null;

        this._settings = null;
        this._gicon = null;
    }

    _readOptions() {
        return {
            mode: this._settings.get_string('result-mode'),
            languages: Pipeline.parseLanguages(this._settings.get_string('ocr-languages')),
        };
    }

    async _warnAboutMissingPackages() {
        const {mode, languages} = this._readOptions();
        const missing = await Pipeline.findMissingPackages(languages, this._cancellable, mode);
        if (missing.length === 0)
            return;
        dependencyWarningShown = true;
        this._notifyMissing(missing);
    }

    _notifyMissing(packages) {
        this._notify(_('Screenshot Scan needs more software'),
            // Translators: %s is a shell command
            _('Install it with:\n%s').format(`sudo dnf install ${packages.join(' ')}`),
            {force: true});
    }

    async _onCapture(bytes) {
        if (!this._settings)
            return; // disabled while the UI was closing
        if (!bytes) {
            this._notify(_('Nothing was captured'), _('Select an area, a screen or a window first.'));
            return;
        }

        // A new capture replaces a scan that is still running.
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;
        const {mode, languages} = this._readOptions();

        let path = null;
        try {
            const missing = await Pipeline.findMissingPackages(languages, cancellable, mode);
            if (missing.length > 0) {
                this._notifyMissing(missing);
                return;
            }

            path = await writeTempPng(bytes, cancellable);
            const {result} = await Pipeline.scanImage(path, {mode, languages, cancellable});
            if (cancellable.is_cancelled())
                return;
            this._deliver(result);
        } catch (e) {
            if (this._logUnlessCancelled(e))
                this._notify(_('Scan failed'), e.message, {force: true});
        } finally {
            if (path)
                deleteQuietly(path);
        }
    }

    _deliver(result) {
        const lines = Pipeline.countLines(result);
        if (lines === 0) {
            this._notify(_('No text found'),
                _('No text or codes were found in the selected area. The clipboard was not changed.'));
            return;
        }

        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, result);

        const preview = result.length > PREVIEW_MAX_CHARS
            ? `${result.slice(0, PREVIEW_MAX_CHARS)}…` : result;
        this._notify(ngettext('Copied %d line', 'Copied %d lines', lines).format(lines), preview);
    }

    /**
     * @param {Error} e
     * @returns {boolean} true if it was a real error (and was logged)
     */
    _logUnlessCancelled(e) {
        if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return false;
        console.error(`${this.uuid}: ${e.message}`);
        return true;
    }

    /**
     * @param {string} title
     * @param {string} body
     * @param {object} [opts]
     * @param {boolean} [opts.force] show even if notifications are turned off
     */
    _notify(title, body, {force = false} = {}) {
        if (!this._settings || (!force && !this._settings.get_boolean('show-notifications')))
            return;

        if (!this._source) {
            this._source = new MessageTray.Source({
                title: _('Screenshot Scan'),
                icon: this._gicon,
            });
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }

        const notification = new MessageTray.Notification({
            source: this._source,
            title,
            body,
            isTransient: true,
        });
        this._source.addNotification(notification);
    }
}
