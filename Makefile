# SPDX-License-Identifier: GPL-2.0-or-later
# Run `make help` for the list. Nothing here needs sudo.

UUID := screenshot-scan@awikman-bot.github.io
ZIP  := build/$(UUID).shell-extension.zip

.PHONY: help test e2e e2e-missing check lint schemas pack install uninstall fixtures clean

help:
	@echo "make test         pipeline tests (gjs + fixtures) and uninstall.sh tests, ~2 s"
	@echo "make e2e          end-to-end test in a headless GNOME Shell (~30 s)"
	@echo "make e2e-missing  e2e with zbar/tesseract hidden (missing-software notices)"
	@echo "make lint         eslint with GNOME's eslint-config-gnome (installs into node_modules/)"
	@echo "make check        lint + test + e2e + e2e-missing (run before every commit)"
	@echo "make pack         build $(ZIP) (extensions.gnome.org upload format)"
	@echo "make install      ./install.sh (checks deps, installs, enables)"
	@echo "make uninstall    ./uninstall.sh"
	@echo "make fixtures     regenerate tests/fixtures/*.png (venv in .venv/)"
	@echo "make clean        remove build output and test scratch"

test:
	gjs -m tests/pipeline.test.js
	tests/uninstall.test.sh

e2e:
	tests/e2e/run.sh

e2e-missing:
	E2E_SCENARIO=missing-tools tests/e2e/run.sh

node_modules: package.json package-lock.json
	npm ci --no-audit --no-fund
	@touch node_modules

lint: node_modules
	npx eslint .

check: lint test e2e e2e-missing

schemas:
	glib-compile-schemas --strict extension/schemas

pack: schemas
	mkdir -p build
	gnome-extensions pack extension --force --out-dir=build \
		--extra-source=lib --extra-source=icons \
		--extra-source=../LICENSE --extra-source=../CREDITS.md
	@echo "Built $(ZIP)"

install:
	./install.sh

uninstall:
	./uninstall.sh

.venv/bin/python:
	python3 -m venv .venv
	.venv/bin/pip install --quiet pillow qrcode python-barcode

fixtures: .venv/bin/python
	.venv/bin/python tests/fixtures/generate.py

clean:
	rm -rf build tests/e2e/out extension/schemas/gschemas.compiled
