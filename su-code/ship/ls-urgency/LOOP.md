# LOOP ls-urgency

| C# | Command |
|---|---|
| C1 | `nice -n 19 ionice -c3 cargo test -j2 -p ccc-core registry` |
| C2 | `nice -n 19 ionice -c3 cargo test -j2 -p su-code --bin 8sync -- ccc::urgent session_view` |
| C3 | `bash scripts/uat/ls-urgency.sh` |
| C4 | `gh pr checks <pr> --watch` |

## Evidence
iter 0 | C1 | exit 0 | Running tests/api.rs (***)
iter 0 | C2 | exit 0 | Running unittests src/main.rs (***)
iter 0 | C3 | exit 0 | ALL PASS
iter 0 | C2 | exit 0 | Running unittests src/main.rs (***)
