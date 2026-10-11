# Releasing Duo

A version tag publishes the Windows application and then updates the download site. A change to the website on `main` deploys the website without rebuilding the app.

## Publish a Windows version

1. Update `package.json`, both root version fields in `package-lock.json`, and `CHANGELOG.md`. Use a new version for changed application files.
2. Run `npm test`, `npm run build` and the relevant smoke suites. Review permissions, provider behavior and storage changes before tagging.
3. Commit and push to `main`. Wait for the Checks workflow to pass.
4. Create and push the matching tag:

   ```powershell
   git tag v0.6.0
   git push origin v0.6.0
   ```

`Publish Windows release` checks the tag against the package version, runs tests and the production audit, builds the unsigned installer, checks the packaged application and update dialog, and creates the source, portable and site archives. It uploads them to a draft release, compares every GitHub asset's size and SHA-256 with the local build, then publishes. An existing public release is never overwritten. A failed upload leaves a draft that can be inspected before rerunning.

`npm run dist` explicitly installs the pinned Electron runtime on fresh machines. Electron Builder publication is disabled; only the verified publish job can publish the release.

Stable links point directly to `Duo-Setup.exe`, `Duo-Windows-x64.zip` and `Duo-Sources.zip` in the latest stable release. Versioned copies remain available. `release.json` carries the versioned URLs and checksums. `SHA256SUMS.txt` covers all distributed files.

The release workflow explicitly calls the site deployment workflow after publication. This also works with GitHub's built-in token, whose release events do not launch another workflow automatically.

## Site updates

The site workflow tests the source website, fetches the latest **published** release manifest, overlays it on a staging copy and sends one ZIP to the VPS. The SSH key can only run the deployment receiver. It cannot open a shell, forward ports or change nginx. The receiver validates the archive, switches `current` atomically and checks the served manifest. Failure restores the previous website. Five deployments are retained.

Before the first public release, the workflow reports that no download is available and skips deployment. Once the release is published, the release workflow deploys it. The workflow can also be launched from Actions → Deploy website → Run workflow on `main`.

## App updates

Duo's **Mises à jour** dialog checks the public stable release only on request. A newer version offers a direct installer download. Users finish missions, save files and close Duo before running it. Installation is not launched automatically. Portable users can download the ZIP from the site.

The manual Windows-build workflow remains available for review builds. Its artifacts are not public releases. Do not include profiles, caches, credentials or private diagnostic reports in any asset. Executables remain unsigned until signing is configured and actually verified.
