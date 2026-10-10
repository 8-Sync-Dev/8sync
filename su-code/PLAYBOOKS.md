# PLAYBOOKS (8sync managed — procedural memory, append-only)

Runbook tái dùng cho quy trình ĐÃ `validated:`. Index theo `When:` để retrieve;
Voyager-style: lưu cái đã chạy được, lần sau adapt thay vì suy luận lại.

## Template
### <tên ngắn>
- **When:** _tình huống kích hoạt (1 dòng để match)_
- **Steps:** _các bước đã verify_
- **Verify:** _cách kiểm chứng_
- **Pitfalls:** _bẫy đã gặp_

_empty_

## Verify Encore Go app không có Docker (Go-level trong podman)
- **When:** cần verify 1 Encore Go app (`//encore:api`, `//encore:authhandler`) trên máy rootless-podman KHÔNG có Docker daemon; `encore run/build/test` không chạy được.
- **Steps:**
  1. `podman run --rm -v <app>:/app:Z -v <name>-gocache:/go -w /app docker.io/library/golang:1.24 sh -c 'go mod tidy && go vet ./... && go build ./... && go test ./...'`
  2. Named volume `/go` = cache module, lần sau nhanh.
  3. Test package Encore: né helper cần runtime (`errs.Code`, `auth.UserID`) — soi field `*errs.Error.Code` trực tiếp.
- **Verify:** VET_OK + BUILD_OK + `ok <pkg>`; encore-native (run/test) đánh dấu NEEDS-CONFIRM cho Docker box.
- **Pitfalls:** `interface{}` trong API type có thể bị encore parser từ chối (go build không bắt); grep endpoint-lister nhớ `--include='*.go'`; `encore build` chỉ có subcommand `docker` (cần Docker).

## Bridge newer omp models into Feynman's older Pi
- **When:** Feynman's bundled Pi lacks a model or provider protocol that authenticated omp already supports.
- **Steps:** Export `omp models --json` (already availability-filtered); persist chat model metadata without remapping provider IDs. Register a custom stream API through `settings.extensions`, preserving settings and user-owned catalog entries. Delegate canonical context/tool results to `omp auth-gateway stdio` with `body.model`, array-valued system prompt and stable session ID.
- **Verify:** Exercise a real tool-call/result continuation, not just `/model` visibility; independently build/test, then drive the real named-session picker through ConPTY on Windows.
- **Pitfalls:** Outer Feynman CLI rejects `--extension`; DB-only auth filtering drops configured API-key providers. Keep required provider fields for retained user models. Native stdio buffers SSE per turn; do not claim token-live output.
