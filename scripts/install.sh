#!/usr/bin/env bash
# Deepa CLI Installation Script for macOS and Linux

set -e

echo "Installing Deepa CLI..."

# GitHub repository details
REPO_OWNER="chandrasekaran1011"
REPO_NAME="deepa"

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     PLATFORM="linux";;
    Darwin*)    PLATFORM="darwin";;
    *)          echo "Unsupported OS: ${OS}"; exit 1;;
esac

# Detect Architecture
ARCH="$(uname -m)"
case "${ARCH}" in
    x86_64* | amd64)    TARGET_ARCH="x64";;
    arm64* | aarch64)   TARGET_ARCH="arm64";;
    *)                  echo "Unsupported architecture: ${ARCH}"; exit 1;;
esac

BINARY_NAME="deepa-${PLATFORM}-${TARGET_ARCH}"
DOWNLOAD_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/${BINARY_NAME}"

INSTALL_DIR="${HOME}/.local/bin"
DEEPA_HOME="${HOME}/.deepa"
REAL_BINARY="${INSTALL_DIR}/deepa-bin"
WRAPPER="${INSTALL_DIR}/deepa"
CA_BUNDLE="${DEEPA_HOME}/ca-bundle.pem"

echo "Detected OS: ${PLATFORM}, Architecture: ${TARGET_ARCH}"
echo "Downloading Deepa from ${DOWNLOAD_URL}..."

# Create directories
mkdir -p "${INSTALL_DIR}"
mkdir -p "${DEEPA_HOME}"

# Download the real binary as deepa-bin
if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${DOWNLOAD_URL}" -o "${REAL_BINARY}"
elif command -v wget >/dev/null 2>&1; then
    wget -qO "${REAL_BINARY}" "${DOWNLOAD_URL}"
else
    echo "Error: Neither curl nor wget is installed."
    exit 1
fi

chmod +x "${REAL_BINARY}"

# ── Export system CA certificates ──────────────────────────────────────────
echo "Exporting system CA certificates for corporate network support..."

if [ "${PLATFORM}" = "darwin" ]; then
    # macOS: export from both System and SystemRoots keychains
    security find-certificate -a -p \
        /Library/Keychains/System.keychain \
        /System/Library/Keychains/SystemRootCertificates.keychain \
        > "${CA_BUNDLE}" 2>/dev/null || true
else
    # Linux: copy from standard system CA bundle locations
    for f in \
        /etc/ssl/certs/ca-certificates.crt \
        /etc/pki/tls/certs/ca-bundle.crt \
        /etc/ssl/ca-bundle.pem \
        /usr/local/share/ca-certificates; do
        if [ -f "${f}" ]; then
            cp "${f}" "${CA_BUNDLE}"
            break
        fi
    done
fi

if [ -s "${CA_BUNDLE}" ]; then
    echo "  ✓ CA bundle written to ${CA_BUNDLE}"
else
    echo "  ⚠ Could not export system CAs — ${CA_BUNDLE} is empty or missing."
    echo "    If you see SSL errors, run: export NODE_EXTRA_CA_CERTS=/path/to/your-ca.pem"
fi

# ── Write the wrapper script ────────────────────────────────────────────────
cat > "${WRAPPER}" << 'WRAPPER_EOF'
#!/bin/sh
# Deepa CLI wrapper — sets NODE_EXTRA_CA_CERTS so Node.js trusts corporate CAs
if [ -s "${HOME}/.deepa/ca-bundle.pem" ]; then
    export NODE_EXTRA_CA_CERTS="${HOME}/.deepa/ca-bundle.pem"
fi
exec "${HOME}/.local/bin/deepa-bin" "$@"
WRAPPER_EOF

chmod +x "${WRAPPER}"

echo ""
echo "Successfully installed Deepa to ${WRAPPER}"

# Check if INSTALL_DIR is in PATH
if echo "$PATH" | grep -q "${INSTALL_DIR}"; then
    echo "You can now run 'deepa' from your terminal!"
else
    echo "========================================================="
    echo "Warning: ${INSTALL_DIR} is not in your PATH."
    echo "Please add it by running the following command:"
    echo ""
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    echo "Add this line to your ~/.bashrc, ~/.zshrc, or ~/.config/fish/config.fish"
    echo "to make it permanent."
    echo "========================================================="
fi
