# Runtime dependency baseline

Checked 2026-09-10. These are adoption checks, not a claim that every dependency's internal implementation has been audited.

| Dependency | Selected release | Evidence and compatibility |
| --- | --- | --- |
| `yaml` | `2.9.0` | npm registry metadata reports Node `>=14.6` and no `deprecated` field. Official [YAML documentation](https://eemeli.org/yaml/) supplies the parse/stringify interfaces. Installed with the selected Node `24.21.0` toolchain; generated OKF output receives public export verification. |
| `@modelcontextprotocol/server` | `2.0.0` | Stable v2 release and Node `>=20`; released server exercised over real stdio using both protocol eras. |
| `@modelcontextprotocol/client` | `2.0.0` | Actual SDK integration client; modern `2026-07-28` and legacy `2025-11-25` demonstrated, including restart. |
| `zod` | `4.6.1` | Direct schema dependency used by the released SDK v2 examples and exercised by the actual fixture's input/output schemas. |

The [MCP experiment](mcp-compatibility.md) records exact release sources, imports, commands and observed limits. The [installed Codex client follow-up](codex-client-smoke.md) closes its initial environment/approval gap with an observed tool call. Node, TypeScript and type-package selection were already recorded in the [current engineering methods research](../research/current-engineering-methods.md).

The repository lockfile fixes dependency resolutions. Recheck release/deprecation status and rerun the affected integration when changing SDK, protocol, serialization or toolchain versions. SDK success does not establish OKF conformance, and successful YAML parsing alone does not establish Justification semantic correctness.
