# Releasing Duo

Build on Windows with a clean checkout and Node.js 24. Changes to provider behavior, permissions or storage require the relevant tests and manual review.

1. Update `package.json`, the root version in `package-lock.json`, and its root package entry. Add a focused changelog entry.
2. Run `npm ci`, `npm test`, `npm run build`, then the relevant smoke suites. Record actual checks in release notes.
3. Run `npm run dist`. It generates original dependency notices before building the unsigned NSIS installer.
4. Update website version labels and fallback URLs, then stage the reviewed public files. Source packaging includes tracked files only and requires this project as its own Git root.
5. Run `python scripts/release-assets.py`. It copies the installer to `Duo-Setup-<version>.exe`, builds the portable and source archives, updates the local website manifest, packages the site and generates `SHA256SUMS.txt`.
6. Never include profiles, caches, generated private logs or credentials. Review archive contents and the source manifest.
7. Check the site and stage its updated release manifest. Source and site hashes live in the external checksum file to avoid a circular hash reference.
8. Commit the reviewed changes, tag `v<version>`, and push the tag. Create a draft GitHub Release, upload all files, verify them, then publish it.

The manual Windows-build workflow creates downloadable build artifacts without publishing a release. Its permissions are read-only; publication remains a maintainer action.

Do not replace a published binary silently. Ship a new version for changed application files. Unsigned status must remain clear until the executables are actually signed.
