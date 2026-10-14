# LOOP no-idle-t6
| C# | lệnh |
|---|---|
| C1 | cargo test -p su-code -j2 -- ccc::taskdone |
| C2 | cargo test -p su-code -j2 -- ccc::taskdone ccc::idle |
| C3 | cargo test -p su-code -j2 -- ccc::idle |
| C4 | vitest team-thread+ingest, typecheck, cargo test -- hq:: |
| C5 | CI ci.yml 3 OS |

## Evidence
iter 0 | C1 | exit 0 | error: could not compile `su-code` (bin "8sync" test) due to 1 previous error; 1 warning emitted
iter 0 | C1 | exit 0 | test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 407 filtered out; finished in 0.03s
iter 0 | C1 | exit 0 | test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 418 filtered out; finished in 0.02s
iter 0 | C4 | exit 0 | test result: ok. 52 passed; 0 failed; 0 ignored; 0 measured; 370 filtered out; finished in 1.50s
iter 0 | C4 | exit 0 | TYPECHECK+LINT OK
iter 0 | C2 | exit 0 | test result: ok. 195 passed; 0 failed; 0 ignored; 0 measured; 227 filtered out; finished in 1.51s
iter 0 | C3 | exit 0 | clippy-touched-files-clean
iter 0 | C4 | exit 101 | error: test failed, to rerun pass `-p su-code --bin 8sync`
iter 0 | C4 | exit 0 | test result: ok. 195 passed; 0 failed; 0 ignored; 0 measured; 227 filtered out; finished in 1.51s
iter 0 | C1 | exit 0 | test result: ok. 195 passed; 0 failed; 0 ignored; 0 measured; 227 filtered out; finished in 1.52s
