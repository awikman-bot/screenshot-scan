// SPDX-License-Identifier: GPL-2.0-or-later
// Test helper: opens a GTK 4 window showing one image at 1:1 scale, so the
// e2e harness can test Window mode. Usage: gjs -m show-image.js <png> <title>
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

const [path, title] = System.programArgs;
const app = new Gtk.Application({application_id: 'io.github.awikman_bot.ScreenshotScanE2E'});
app.connect('activate', () => {
    const picture = Gtk.Picture.new_for_filename(path);
    picture.can_shrink = false;
    const win = new Gtk.ApplicationWindow({application: app, title, child: picture});
    win.present();
});
app.run([]);
