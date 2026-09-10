# Installed Codex client smoke

Checked 2026-09-10 with Codex CLI `0.153.4`, model `gpt-5.6-luna`, reasoning effort `max`, Node `24.21.0` and the SDK `2.0.0` fixture described in [MCP compatibility](mcp-compatibility.md).

The first attempt in that report invoked `/Users/awjre/.local/bin/codex`, a symlink to `/Applications/ChatGPT.app/Contents/Resources/codex`. The CLI searched for its Code Mode host beside the symlink, where it was absent. Inspection found the existing executable at `/Applications/ChatGPT.app/Contents/Resources/codex-code-mode-host`. Invoking the real CLI path let Code Mode start without installing or modifying anything.

The next run reached the fixture MCP tool, but the CLI's noninteractive approval policy rejected the call. This was a client approval failure, not an SDK protocol failure. A returned model answer of 42 was again excluded from success evidence.

The successful run used the real executable, ephemeral configuration and `--approve-for-me`, which routes requests through automatic approval review with a workspace-write sandbox. It did not disable the sandbox, ignore rules or change global configuration. Only the temporary fixture's local arithmetic call was authorized.

```sh
/Applications/ChatGPT.app/Contents/Resources/codex exec \
  --ephemeral --ignore-user-config --skip-git-repo-check \
  -m gpt-5.6-luna -c 'model_reasoning_effort="max"' \
  -c 'mcp_servers.fixture={command="/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node",args=["/private/tmp/justification-mcp-compatibility/fixture-server.mjs"]}' \
  --approve-for-me --json --color never \
  --cd /private/tmp/justification-mcp-compatibility \
  'Use the MCP server named fixture. I authorize one call to its harmless local arithmetic add tool with a=2 and b=40 as an integration test. The fixture logs the call only within this temporary workspace. Call that tool exactly once and report the observed result. Do not use shell, filesystem, network, or any other tool.'
```

Observed evidence:

- Process exit status: `0`.
- JSONL event: `mcp_tool_call`, server `fixture`, tool `add`, arguments `{ "a": 2, "b": 40 }`, status `completed`, error `null`.
- Tool result: text `{"sum":42}` and structured content `{ "sum": 42 }`.
- Independent fixture marker: exactly one new line, `2,40`.

Temporary output files were `codex-reviewed.jsonl`, `codex-reviewed.stderr` and `codex-call-marker` under the fixture directory. The CLI also emitted state-database lookup warnings; they did not prevent the observed tool call. Logs were inspected locally and are not shipped as project data.

This closes the installed-client invocation gap in the earlier experiment. The negotiated protocol version was not instrumented in this Codex run, so this report does not infer it from the SDK's version. Separate SDK client runs explicitly demonstrated both `2026-07-28` and `2025-11-25`.

## Production server: two configured projects

On the same date, the installed client also connected to the built production
`dist/cli.js mcp` server. This run took place during development after transport
commit `43448ab`, with the subsequent stdin test correction in the working
tree; it is integration evidence, not a claim that the final release was
already complete.

Two fresh initialized projects, `project-alpha` and `project-beta`, were
created under `/private/tmp/justification-production-codex-4MdrkX`. Their
revision-zero histories were established before launching Codex. The command
used the same executable, model, reasoning effort and approval configuration
above, replacing the server setting with:

```text
mcp_servers.justification={command="/private/tmp/justification-toolchain/node-v24.21.0-darwin-arm64/bin/node",args=["/Users/awjre/Work/justification/dist/cli.js","mcp","/private/tmp/justification-production-codex-4MdrkX/project-alpha","/private/tmp/justification-production-codex-4MdrkX/project-beta"]}
```

The prompt authorized exactly one `projects` call and one `knowledge_bases`
call for each returned project ID, without knowledge mutations or other tools.
The process exited `0`. Its JSONL contained exactly three completed
`mcp_tool_call` events with `error: null`: project discovery returned both
independently initialized IDs and names, and each scoped call returned its own
project identity, revision `0`, and the `shared` knowledge base. Both text and
structured tool results were present. The evidence is the actual tool events,
not the client's concluding prose.

Temporary logs were inspected locally as `codex-production.jsonl` and
`codex-production.stderr` inside that workspace. Negotiated protocol version
was again not instrumented for Codex. Full graph lifecycle, explicit protocol
versions and restart are covered separately through the SDK client tests.
