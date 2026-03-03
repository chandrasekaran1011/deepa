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
EXECUTABLE_PATH="${INSTALL_DIR}/deepa"

echo "Detected OS: ${PLATFORM}, Architecture: ${TARGET_ARCH}"
echo "Downloading Deepa from ${DOWNLOAD_URL}..."

# Create install directory if it doesn't exist
mkdir -p "${INSTALL_DIR}"

# Download the executable
if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${DOWNLOAD_URL}" -o "${EXECUTABLE_PATH}"
elif command -v wget >/dev/null 2>&1; then
    wget -qO "${EXECUTABLE_PATH}" "${DOWNLOAD_URL}"
else
    echo "Error: Neither curl nor wget is installed."
    exit 1
fi

# Make it executable
chmod +x "${EXECUTABLE_PATH}"

echo ""
echo "Successfully installed Deepa to ${EXECUTABLE_PATH}"

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
