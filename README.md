<p align="center">
  <a href="https://github.com/premsuggu/ktether">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="ktether logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://github.com/premsuggu/ktether"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@ktether/cli"><img alt="npm" src="https://img.shields.io/npm/v/@ktether/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/ktether/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/ktether/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![ktether Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/premsuggu/ktether)

---

### Installation

```bash
# YOLO
curl -fsSL https://github.com/premsuggu/ktether | bash

# Package managers
npm i -g @ktether/cli@latest      # or bun/pnpm/yarn
scoop install ktether             # Windows
choco install ktether             # Windows
brew install anomalyco/tap/ktether # macOS and Linux (recommended, always up to date)
brew install ktether              # macOS and Linux (official brew formula, updated less)
sudo pacman -S ktether            # Arch Linux (Stable)
paru -S ktether-bin               # Arch Linux (Latest from AUR)
mise use -g ktether               # Any OS
nix run nixpkgs#ktether           # or github:anomalyco/ktether for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

ktether is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/ktether/releases) or [ktether.ai/download](https://github.com/premsuggu/ktether).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `ktether-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `ktether-desktop-mac-x64.dmg`     |
| Windows               | `ktether-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask ktether-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/ktether-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$KTETHER_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.ktether/bin` - Default fallback

```bash
# Examples
KTETHER_INSTALL_DIR=/usr/local/bin curl -fsSL https://github.com/premsuggu/ktether | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://github.com/premsuggu/ktether | bash
```

### Agents

ktether includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://github.com/premsuggu/ktether/tree/main/docs).

### Documentation

For more info on how to configure ktether, [**head over to our docs**](https://github.com/premsuggu/ktether/tree/main/docs).

### Contributing

If you're interested in contributing to ktether, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on ktether

If you are working on a project that's related to ktether and is using "ktether" as part of its name, for example "ktether-dashboard" or "ktether-mobile", please add a note to your README to clarify that it is not built by the ktether team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/ktether) | [X.com](https://x.com/ktether)
