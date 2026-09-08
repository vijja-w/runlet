#!/bin/sh
set -eu

REPOSITORY="vijja-w/runlet"
INSTALL_ROOT="${RUNLET_INSTALL_DIR:-$HOME/.local/share/runlet}"
BIN_DIR="${RUNLET_BIN_DIR:-$HOME/.local/bin}"

fail() {
  printf 'Runlet installation failed: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail 'curl is required to download Runlet.'

case "$(uname -s)" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) architecture="arm64" ;;
  x86_64|amd64) architecture="x64" ;;
  *) fail "unsupported CPU architecture: $(uname -m)" ;;
esac

if [ "$platform" = "linux" ] && [ "$architecture" != "x64" ]; then
  fail 'Linux releases currently support x64 only.'
fi

if [ -e "$BIN_DIR/runlet" ] && [ ! -L "$BIN_DIR/runlet" ]; then
  fail "$BIN_DIR/runlet already exists and is not a Runlet installer symlink."
fi

asset="runlet-${platform}-${architecture}.tar.gz"
case "${RUNLET_VERSION:-}" in
  '') release_url="https://github.com/${REPOSITORY}/releases/latest/download" ;;
  *[!0-9A-Za-z.+-]*) fail 'RUNLET_VERSION contains invalid characters.' ;;
  *) release_url="https://github.com/${REPOSITORY}/releases/download/v${RUNLET_VERSION}" ;;
esac
temporary_dir=$(mktemp -d 2>/dev/null || mktemp -d -t runlet)
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

printf 'Downloading Runlet for %s %s...\n' "$platform" "$architecture"
curl -fL --retry 3 --connect-timeout 15 -o "$temporary_dir/$asset" "$release_url/$asset" \
  || fail 'could not download the latest release.'
curl -fL --retry 3 --connect-timeout 15 -o "$temporary_dir/SHA256SUMS" "$release_url/SHA256SUMS" \
  || fail 'could not download release checksums.'

expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1; exit }' "$temporary_dir/SHA256SUMS")
[ -n "$expected" ] || fail "no checksum was published for $asset."
if command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$temporary_dir/$asset" | awk '{ print $1 }')
elif command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$temporary_dir/$asset" | awk '{ print $1 }')
else
  fail 'a SHA-256 utility (shasum or sha256sum) is required.'
fi
[ "$actual" = "$expected" ] || fail 'the downloaded archive did not match its SHA-256 checksum.'

tar -xzf "$temporary_dir/$asset" -C "$temporary_dir" || fail 'could not extract the release archive.'
[ -x "$temporary_dir/runlet/runlet" ] || fail 'the release archive does not contain the Runlet launcher.'
[ -x "$temporary_dir/runlet/runtime/node" ] || fail 'the release archive does not contain its runtime.'
installed_version=$(awk -F'"' '/"version"[[:space:]]*:/ { print $4; exit }' "$temporary_dir/runlet/package.json")
[ -n "$installed_version" ] || fail 'the release archive does not declare a version.'

case "$INSTALL_ROOT" in
  ''|'/'|"$HOME") fail "unsafe install location: $INSTALL_ROOT" ;;
esac

if [ -x "$INSTALL_ROOT/runlet" ]; then
  RUNLET_NO_OPEN=1 "$INSTALL_ROOT/runlet" kill >/dev/null 2>&1 || true
fi

mkdir -p "$(dirname "$INSTALL_ROOT")" "$BIN_DIR"
replacement="${INSTALL_ROOT}.new.$$"
backup="${INSTALL_ROOT}.old.$$"
rm -rf "$replacement"
mv "$temporary_dir/runlet" "$replacement"
if [ -e "$INSTALL_ROOT" ]; then mv "$INSTALL_ROOT" "$backup"; fi
if ! mv "$replacement" "$INSTALL_ROOT"; then
  if [ -e "$backup" ]; then mv "$backup" "$INSTALL_ROOT"; fi
  fail 'could not move Runlet into its install location.'
fi
if [ -e "$backup" ]; then rm -rf "$backup"; fi
ln -sfn "$INSTALL_ROOT/runlet" "$BIN_DIR/runlet"

path_updated=0
add_path_to_profile() {
  profile="$1"
  marker="# Runlet command"
  if ! grep -F "$marker" "$profile" >/dev/null 2>&1; then
    {
      printf '\n%s\n' "$marker"
      printf 'export PATH="%s:$PATH"\n' "$BIN_DIR"
    } >> "$profile"
    path_updated=1
  fi
}
case "${SHELL:-}" in
  */zsh)
    add_path_to_profile "$HOME/.zprofile"
    add_path_to_profile "$HOME/.zshrc"
    ;;
  */bash)
    add_path_to_profile "$HOME/.bash_profile"
    add_path_to_profile "$HOME/.bashrc"
    ;;
  *) add_path_to_profile "$HOME/.profile" ;;
esac

printf '\nRunlet %s installed successfully.\n' "$installed_version"
if [ "$path_updated" -eq 1 ]; then
  printf 'Open a new terminal, then run: runlet\n'
else
  printf 'Run: runlet\n'
fi
printf 'Uninstall later with: runlet uninstall\n'
