// SPDX-License-Identifier: MIT OR LGPL-2.1-or-later
// SPDX-FileCopyrightText: 2025 Florian Müllner <fmuellner@gnome.org>
//
// Adapted from gnome-shell 50.6 eslint.config.js (see CREDITS.md): the same
// eslint-config-gnome presets and rule overrides gnome-shell itself uses,
// plus the globals GNOME Shell provides to extensions.

import {defineConfig} from '@eslint/config-helpers';
import gnome from 'eslint-config-gnome';

export default defineConfig([
    gnome.configs.recommended,
    gnome.configs.jsdoc,
    {
        ignores: ['node_modules', 'build', 'tests/e2e/out', '.venv'],
    }, {
        rules: {
            camelcase: ['error', {properties: 'never'}],
            'consistent-return': 'error',
            'eqeqeq': ['error', 'smart'],
            'key-spacing': ['error', {mode: 'minimum', beforeColon: false, afterColon: true}],
            'prefer-arrow-callback': 'error',
            'prefer-const': ['error', {destructuring: 'all'}],
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns-description': 'off',
            'jsdoc/require-jsdoc': ['error', {exemptEmptyFunctions: true, publicOnly: {esm: true}}],
        },
    }, {
        // Code that runs inside GNOME Shell.
        files: ['extension/**', 'tests/e2e/harness/**'],
        languageOptions: {globals: {global: 'readonly'}},
    }, {
        files: ['tests/**'],
        rules: {'jsdoc/require-jsdoc': 'off', 'jsdoc/require-param': 'off'},
    },
]);
