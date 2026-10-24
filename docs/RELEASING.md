# Build and release

[Back to the project](../README.md) · [Development setup](DEVELOPMENT.md)

## Build a Windows app locally

Complete the [Windows development setup](DEVELOPMENT.md#set-up-windows-development), then run these commands from the repository root:

```powershell
npm ci
npm run check:versions
npm run deploy
```

`deploy` builds the production userscript and release Tauri executable, then assembles these files in `deploy/`:

| File | Contents |
| --- | --- |
| `DigDig-Map-Observatory.exe` | Portable Windows app with the userscript and local bridge embedded. |
| `digdig.user.js` | Generic userscript without a personalized pairing credential. |
| `README.txt` | Installation and troubleshooting instructions. |
| `manifest.json` | App version, platform, architecture, build time, file sizes, and SHA-256 hashes. |

Save any active scan as `.chunks` and close the previous deployed executable before replacing it; Windows cannot overwrite a running EXE. The script replaces only the files it produces and leaves other files in `deploy/` alone.

The app runs without Node, npm, Rust, or the source checkout. Windows needs WebView2. The current build is a portable, unsigned executable. The in-app **Install userscript**, **Copy to clipboard**, and **Export .user.js** actions produce a paired script for that installation. Share the generic `deploy/digdig.user.js`, not a personalized export.

### Create the release ZIP and checksums

`npm run deploy` creates the four files above. On Windows x64, run the separate packaging helper to verify them and add the archive and checksum list:

```powershell
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
./tools/package-windows-release.ps1 -Tag "v$releaseVersion"
```

This produces `deploy/digdig-tools-vX.Y.Z-windows-x64.zip` and `deploy/SHA256SUMS.txt`. The ZIP contains the EXE, generic userscript, README, and manifest. The checksum list covers those four files and the ZIP.

The helper verifies the manifest's version and Windows x64 architecture, file sizes and hashes, the EXE's **Flammrock** company metadata and `X.Y.Z.0` versions, the userscript version, and that the executable embeds that exact generic script. Its explicit file list keeps unrelated local files out of the archive.

## GitHub releases

The [Release Windows workflow](../.github/workflows/main.yml) uses [release-please](https://github.com/googleapis/release-please-action) to prepare releases from conventional commits pushed to `main`:

1. Release-please opens or updates a PR with the version changes and changelog.
2. A maintainer reviews and merges that PR.
3. Release-please creates the `vX.Y.Z` tag and GitHub release.
4. The Windows x64 job checks out that exact tag, checks versions, runs TypeScript/JavaScript/Rust checks, builds and verifies the package, and uploads the downloads.

Release assets include the four deployment files, the ZIP, and `SHA256SUMS.txt`. The workflow also retains them as an Actions artifact for 14 days.

### Repository setup

In **Settings → Actions → General**, enable **Allow GitHub Actions to create and approve pull requests**. GitHub combines those permissions into one checkbox; this workflow uses PR creation and **does not approve or merge release PRs**. Review and merging remain maintainer actions. The required workflow permissions are already declared in the YAML. See the [release-please permission requirements](https://github.com/googleapis/release-please-action#workflow-permissions).

The built-in `GITHUB_TOKEN` is sufficient for this pipeline. An optional repository secret named `MY_RELEASE_PLEASE_TOKEN` overrides it when needed. The Windows job is part of the same workflow because release/tag events created with `GITHUB_TOKEN` do not start another workflow. [GitHub workflow trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)

### First release of the rewrite

The release manifest intentionally starts at **1.2.2**, the previous published release, while the rewritten source is **2.0.0**. The configured bootstrap commit marks the historical baseline. For the first commit containing the rewrite and release setup, use:

```text
feat!: rebuild the desktop app with Tauri and Nx

Release-As: 2.0.0
```

After pushing it, review and merge the resulting **2.0.0** release PR. The footer selects this one release; no permanent `release-as` override is configured. Later `fix:` commits produce patch releases, `feat:` commits produce minor releases, and breaking changes produce major releases.

Release-please keeps root and workspace package versions, npm and Cargo lockfiles, and the EXE's version metadata aligned. Run `npm run check:versions` to detect drift. When adding an npm workspace, also add its `package-lock.json` workspace entry to [`release-please-config.json`](../release-please-config.json).

### Retry an existing release

If building or uploading fails after the release exists, rerun the failed job. Alternatively, choose **Actions → Release Windows → Run workflow** on `main` and enter the existing stable tag, such as `v2.0.0`, in **release_tag**. The tag must already have a GitHub release.

This rebuilds the tagged source and replaces the release assets. Leaving **release_tag** blank runs release-please to update the release PR instead. The retry mechanism does not create a release from an arbitrary tag.
