"""Create an offline project CA and its HTTPS server certificate."""

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def write_key(path: Path, key: rsa.RSAPrivateKey) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-dir", type=Path, required=True)
    parser.add_argument("--cert-dir", type=Path, default=Path("k8s/certs"))
    parser.add_argument("--hostname", required=True)
    args = parser.parse_args()
    args.private_dir.mkdir(parents=True, exist_ok=True)
    args.cert_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "aira-project-ca")])
    ca_ski = x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key())
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False,
                                     data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                     crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
        .add_extension(ca_ski, critical=False)
        .add_extension(x509.AuthorityKeyIdentifier(ca_ski.digest, None, None), critical=False)
        .sign(ca_key, hashes.SHA256())
    )

    tls_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    leaf_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, args.hostname)])
    leaf_cert = (
        x509.CertificateBuilder()
        .subject_name(leaf_name)
        .issuer_name(ca_name)
        .public_key(tls_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=730))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(args.hostname)]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=True,
                                     data_encipherment=False, key_agreement=False, key_cert_sign=False,
                                     crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(tls_key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256())
    )

    write_key(args.private_dir / "aira-project-ca.key", ca_key)
    write_key(args.private_dir / "aira-tls.key", tls_key)
    (args.cert_dir / "ca.crt").write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    (args.cert_dir / "tls.crt").write_bytes(leaf_cert.public_bytes(serialization.Encoding.PEM))
    print(f"Certificados creados para {args.hostname}")
    print(f"CA SHA-256: {ca_cert.fingerprint(hashes.SHA256()).hex()}")
    print(f"Hoja SHA-256: {leaf_cert.fingerprint(hashes.SHA256()).hex()}")


if __name__ == "__main__":
    main()
