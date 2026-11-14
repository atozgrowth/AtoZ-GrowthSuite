import assert from "node:assert/strict";
import test from "node:test";
import { checkServerIdentity, type PeerCertificate } from "node:tls";
import { isPublicWordPressAddress, wordPressTlsIdentity } from "./wordpress-site-client.js";
test("WordPress egress rejects alternate IPv6 encodings of private destinations", () => {
  for (const address of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001::1", "2001:2::1", "::", "::1", "fe80::1", "fd00::1", "ff02::1", "2001:db8::1", "3fff::1", "invalid"]) {
    assert.equal(isPublicWordPressAddress(address), false, address);
  }
});
test("WordPress egress rejects local IPv4 and accepts native public addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "255.255.255.255"]) assert.equal(isPublicWordPressAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicWordPressAddress(address), true, address);
});

test("IPv6 URL brackets are excluded from address/certificate identity, not the Host header", () => {
  const url = new URL("https://[2606:4700:4700::1111]/wordpress");
  const identity = wordPressTlsIdentity(url);
  assert.equal(identity.certificateHost, "2606:4700:4700::1111");
  assert.equal(identity.servername, undefined);
  const certificate = { subjectaltname: "IP Address:2606:4700:4700::1111" } as PeerCertificate;
  assert.equal(checkServerIdentity(identity.certificateHost, certificate), undefined);
  assert.ok(checkServerIdentity("2606:4700:4700::1112", certificate));
  assert.equal(identity.hostHeader, "[2606:4700:4700::1111]");
  assert.equal(isPublicWordPressAddress(identity.certificateHost), true);
  for (const value of ["https://[::1]", "https://[::ffff:7f00:1]", "https://[fd00::1]"]) {
    assert.equal(isPublicWordPressAddress(wordPressTlsIdentity(new URL(value)).certificateHost), false);
  }
});
test("TLS SNI remains DNS-only and certificate identity remains the original requested host", () => {
  assert.deepEqual(wordPressTlsIdentity(new URL("https://site.example.test")), {
    certificateHost: "site.example.test", servername: "site.example.test", hostHeader: "site.example.test",
  });
  assert.deepEqual(wordPressTlsIdentity(new URL("https://8.8.8.8")), {
    certificateHost: "8.8.8.8", servername: undefined, hostHeader: "8.8.8.8",
  });
});
