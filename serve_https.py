#!/usr/bin/env python3
"""Local HTTPS development server + EMODnet/ETOPO1 Bathymetry Proxy for SSN-774 Simulator."""
import functools
import http.server
import json
import os
import ssl
import subprocess
import urllib.parse
import urllib.request

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


def fetch_real_bathymetry(lat, lon):
    """Queries EMODnet Bathymetry (Mediterranean DTM), falling back to OpenTopoData ETOPO1."""
    try:
        emodnet_url = f"https://rest.emodnet-bathymetry.eu/depth_sample?geom=POINT({lon:.5f}%20{lat:.5f})"
        with urllib.request.urlopen(emodnet_url, timeout=4.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            val = data.get("avg") if data.get("avg") is not None else data.get("smoothed")
            if val is not None:
                elev_m = float(val)
                ref = (data.get("reference") or {}).get("identifier") or "EMODnet DTM"
                return {
                    "depthM": 0 if elev_m >= -1.0 else round(abs(elev_m)),
                    "elevationM": round(elev_m, 1),
                    "source": f"EMODnet ({ref})"
                }
    except Exception:
        pass

    try:
        etopo_url = f"https://api.opentopodata.org/v1/etopo1?locations={lat:.5f},{lon:.5f}"
        with urllib.request.urlopen(etopo_url, timeout=4.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results") or []
            if results and results[0].get("elevation") is not None:
                elev_m = float(results[0]["elevation"])
                return {
                    "depthM": 0 if elev_m >= -1.0 else round(abs(elev_m)),
                    "elevationM": round(elev_m, 1),
                    "source": "ETOPO1"
                }
    except Exception:
        pass

    return None


class SubmarineHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/bathymetry":
            qs = urllib.parse.parse_qs(parsed.query)
            try:
                lat = float(qs.get("lat", [""])[0])
                lon = float(qs.get("lon", [""])[0])
            except (TypeError, ValueError):
                self.send_response(400)
                self.end_headers()
                return

            result = fetch_real_bathymetry(lat, lon)
            if result is None:
                self.send_response(502)
                self.end_headers()
                return

            body = json.dumps(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()


def main():
    ensure_self_signed_cert()
    handler = functools.partial(SubmarineHTTPHandler, directory=ROOT_DIR)
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    print(f"Serving HTTPS on https://localhost:{PORT}/", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
