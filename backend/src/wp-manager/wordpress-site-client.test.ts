import assert from "node:assert/strict";
import test from "node:test";
import { isPublicWordPressAddress } from "./wordpress-site-client.js";
test("WordPress egress rejects alternate IPv6 encodings of private destinations", () => {
  for (const address of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001::1", "2001:2::1", "::", "::1", "fe80::1", "fd00::1", "ff02::1", "2001:db8::1", "3fff::1", "invalid"]) {
    assert.equal(isPublicWordPressAddress(address), false, address);
  }
});
test("WordPress egress rejects local IPv4 and accepts native public addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "255.255.255.255"]) assert.equal(isPublicWordPressAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicWordPressAddress(address), true, address);
});
