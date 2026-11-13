# RC artifact delivery

`RC artifact delivery` builds application commit `4cdf318464719972f6e5a62c2c61d9a06b2a0ab1` for `v2026.11.14-rc.1`. It runs on relevant tooling PRs, or manual dispatch after the workflow is available on the default branch. Changing the application revision/version requires a reviewed code change; dispatch accepts no arbitrary ref or command input.

The workflow token has only `contents: read`; checkout does not persist it. Artifact upload uses GitHub's runner artifact service, with no release-write permission, environment, repository secret, production credential, external VPS connection or deployment step. Only synthetic Supabase fixtures are supplied. No GitHub Release is created or edited.

Every run/attempt has a unique artifact name and ID, with overwrite disabled. This is an independently built delivery of the same application source, not a byte-for-byte replacement of the earlier locally prepared bundle. Its identity is the source SHA, tooling SHA, run/attempt, artifact ID, ZIP digest and internal checksums. No previous RC bytes are overwritten.

Contents include the exact Git source archive, saved OCI images, per-image OCI manifest and configuration digests, resolved base-image digests, build recipes, tests/audits/runtime/routing evidence, fixture environment contract and rollback prerequisites. OCI blobs and descriptors are verified before upload. Frontend images remain validation-only; a production-configured build requires a new version and approval. Rollback identifiers stay null until separately authorized live verification. No migration or live readiness check is performed.

## Download and verification

Use the run's artifact link while signed into an account with repository access. The artifact link and ZIP SHA-256 appear in the run summary. Alternatively use the GitHub API to download `/repos/atozgrowth/AtoZ-GrowthSuite/actions/artifacts/ARTIFACT_ID/zip`; the response redirects to temporary storage. Keep signed redirect URLs private and do not forward GitHub Authorization headers to the storage host.

Run the verifier from the reviewed tooling commit:

```bash
python3 scripts/rc/verify.py artifact.zip \
  --expected-source 4cdf318464719972f6e5a62c2c61d9a06b2a0ab1 \
  --expected-zip-sha256 ZIP_DIGEST_FROM_GITHUB
```

It checks the outer ZIP digest, complete file-checksum inventory, source identity and every OCI blob/manifest/config/layer descriptor. CI verifies the same contents before upload. Checksums are unsigned; retain the API/run digest separately from the downloaded ZIP. The artifact expires after 30 days and can be deleted by authorized administrators. It is suitable for review delivery, not permanent release retention or a signed provenance guarantee. Future archival or release attachment needs separate authorization and verified delivery; do not change the existing draft release during this experiment.
