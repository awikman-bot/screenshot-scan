// SPDX-License-Identifier: GPL-2.0-or-later
//
// Preferences window (runs in a separate GTK process, not in the Shell).
// Open with: gnome-extensions prefs screenshot-scan@awikman-bot.github.io

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Pipeline from './lib/pipeline.js';

const MODES = [
    ['auto', () => _('Automatic')],
    ['codes', () => _('Codes only')],
    ['text', () => _('Text only')],
    ['both', () => _('Codes and text')],
];

export default class ScreenshotScanPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep alive with the window

        const page = new Adw.PreferencesPage({
            title: _('Screenshot Scan'),
            icon_name: 'edit-select-all-symbolic',
        });
        window.add(page);

        // ---- Result -----------------------------------------------------
        const resultGroup = new Adw.PreferencesGroup({
            title: _('Result'),
            description: _('What is copied to the clipboard after a scan.'),
        });
        page.add(resultGroup);

        const modeRow = new Adw.ComboRow({
            title: _('Copy'),
            subtitle: _('Automatic: QR and barcode contents if any are found, otherwise the text.'),
            model: Gtk.StringList.new(MODES.map(([, label]) => label())),
        });
        const syncMode = () => {
            const i = MODES.findIndex(([id]) => id === settings.get_string('result-mode'));
            modeRow.selected = Math.max(i, 0);
        };
        syncMode();
        modeRow.connect('notify::selected', () => {
            const id = MODES[modeRow.selected]?.[0];
            if (id && id !== settings.get_string('result-mode'))
                settings.set_string('result-mode', id);
        });
        settings.connect('changed::result-mode', syncMode);
        resultGroup.add(modeRow);

        const notifyRow = new Adw.SwitchRow({
            title: _('Show notifications'),
            subtitle: _('Errors are always shown.'),
        });
        settings.bind('show-notifications', notifyRow, 'active', 0);
        resultGroup.add(notifyRow);

        // ---- OCR languages ------------------------------------------------
        const langGroup = new Adw.PreferencesGroup({
            title: _('Text recognition languages'),
            description: _('Pick only the languages you need: each extra one makes OCR slower. ' +
                'To add more, install a language pack, e.g.\nsudo dnf install tesseract-langpack-fin'),
        });
        page.add(langGroup);

        let installed = [];
        try {
            installed = (await Pipeline.listInstalledLanguages())
                .filter(l => l !== 'osd'); // orientation data, not a language
        } catch (e) {
            console.error(`screenshot-scan prefs: ${e.message}`);
        }

        const missing = Pipeline.findMissingTools();
        if (missing.length > 0) {
            langGroup.add(new Adw.ActionRow({
                title: _('Required software is missing'),
                subtitle: `sudo dnf install ${missing.map(t => t.package).join(' ')} tesseract-langpack-eng`,
                subtitle_selectable: true,
            }));
        }

        const current = () => Pipeline.parseLanguages(settings.get_string('ocr-languages'));
        // Show configured-but-uninstalled languages too, so they can be removed.
        const shown = [...new Set([...installed, ...current()])];

        for (const lang of shown) {
            const isInstalled = installed.includes(lang);
            const row = new Adw.SwitchRow({
                title: lang,
                subtitle: isInstalled ? '' : _('Not installed: sudo dnf install %s')
                    .replace('%s', Pipeline.langpackFor(lang)), // no String.format outside the Shell
                active: current().includes(lang),
            });
            row.connect('notify::active', () => {
                let langs = current().filter(l => l !== lang);
                if (row.active)
                    langs.push(lang); // keep the user's order; first = primary
                if (langs.length === 0) {
                    // Tesseract needs at least one language.
                    row.active = true;
                    return;
                }
                settings.set_string('ocr-languages', langs.join('+'));
            });
            langGroup.add(row);
        }
    }
}
