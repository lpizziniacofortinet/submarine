#!/usr/bin/env python3
"""Local HTTPS development server for SSN-774 Submarine Simulator."""
import functools
import http.server
import os
import ssl
import subprocess

PORT = int(os.environ.get("PORT", "8443"))
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = "/tmp/submarine-ssl"
CERT_FILE = os.path.join(CERT_DIR, "cert.pem")
KEY_FILE = os.path.join(CERT_DIR, "key.pem")


def ensure_self_signed_cert():
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return
    os.makedirs(CERT_DIR, exist_ok=True)
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", KEY_FILE, "-out", CERT_FILE,
            "-days", "365", "-nodes",
            "-subj", "/CN=localhost",
            "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main():
    ensure_self_signed_cert()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT_DIR)
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    print(f"Serving HTTPS on https://localhost:{PORT}/", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
