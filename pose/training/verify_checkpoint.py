#!/usr/bin/env python3
# HUM-100-K §42 artifact integrity: independent SHA-256 verification of an
# exported checkpoint's exact bytes against the digest recorded in the export
# record (the artifact_sha256 line printed at export time). This is
# deliberately independent of the manifest's embedded checksumSha256 — that
# checksum covers only the model parameter blob, so metadata-only tampering
# (evaluation numbers, evidence labels) would survive it. The artifact digest
# covers every byte of the file. Exit nonzero with a clear diagnostic on:
# mismatch, malformed digest, unreadable file.
import argparse, hashlib, re, sys

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--sha256", required=True, help="expected artifact digest from the export record")
    args = ap.parse_args()
    expected = args.sha256.strip().lower()
    if not SHA256_RE.match(expected):
        print("verify_checkpoint: FAIL — malformed digest: expected 64 lowercase hex chars", file=sys.stderr)
        sys.exit(2)
    try:
        with open(args.checkpoint, "rb") as f:
            blob = f.read()
    except OSError as e:
        print(f"verify_checkpoint: FAIL — checkpoint unreadable: {e.strerror or e}", file=sys.stderr)
        sys.exit(2)
    actual = hashlib.sha256(blob).hexdigest()
    if actual != expected:
        print(f"verify_checkpoint: FAIL — artifact digest mismatch (actual {actual[:16]}… vs expected {expected[:16]}…): file bytes diverge from the export record; do not consume this checkpoint", file=sys.stderr)
        sys.exit(1)
    print(f"verify_checkpoint: PASS — artifact bytes match export record (sha256 {actual})")
    sys.exit(0)

if __name__ == "__main__":
    main()
