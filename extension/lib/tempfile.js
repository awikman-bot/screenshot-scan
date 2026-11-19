// SPDX-License-Identifier: GPL-2.0-or-later
//
// Private temporary PNG files in $XDG_RUNTIME_DIR (a per-user tmpfs that is
// wiped at logout). No GNOME Shell imports, so tests can use it too.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const TEMP_PREFIX = 'screenshot-scan-';
const TEMP_SUFFIX = '.png';

/**
 * @returns {string} $XDG_RUNTIME_DIR (GLib falls back to the cache dir if unset)
 */
export function tempDir() {
    return GLib.get_user_runtime_dir();
}

/**
 * Writes bytes to a new mode-0600 file in the runtime dir.
 *
 * @param {GLib.Bytes} bytes PNG data
 * @param {Gio.Cancellable|null} cancellable
 * @returns {Promise<string>} the file path
 */
export function writeTempPng(bytes, cancellable = null) {
    const path = GLib.build_filenamev([
        tempDir(), `${TEMP_PREFIX}${GLib.uuid_string_random()}${TEMP_SUFFIX}`,
    ]);
    const file = Gio.File.new_for_path(path);
    return new Promise((resolve, reject) => {
        file.replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.PRIVATE, cancellable, (f, res) => {
                try {
                    f.replace_contents_finish(res);
                    resolve(path);
                } catch (e) {
                    reject(e);
                }
            });
    });
}

/**
 * Deletes a file, ignoring "not found".
 *
 * @param {string} path
 */
export function deleteQuietly(path) {
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            console.warn(`screenshot-scan: could not delete ${path}: ${e.message}`);
    }
}

/**
 * Deletes temp files left behind by a crash or a Shell restart mid-scan.
 *
 * @returns {number} how many files were removed
 */
export function purgeStaleTempFiles() {
    let removed = 0;
    try {
        const dir = Gio.File.new_for_path(tempDir());
        const iter = dir.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let info;
        while ((info = iter.next_file(null)) !== null) {
            const name = info.get_name();
            if (name.startsWith(TEMP_PREFIX) && name.endsWith(TEMP_SUFFIX)) {
                deleteQuietly(GLib.build_filenamev([tempDir(), name]));
                removed++;
            }
        }
        iter.close(null);
    } catch (e) {
        console.warn(`screenshot-scan: could not list ${tempDir()}: ${e.message}`);
    }
    return removed;
}
